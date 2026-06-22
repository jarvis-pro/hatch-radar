import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '@/modules/account/auth-user.decorator';
import { SessionAuthGuard } from '@/modules/account/session-auth.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { type ConnectorInput } from '@/lib/db';
import { SourcesService } from '@/domain';

const platformEnum = z.enum(['reddit', 'hackernews', 'rss']);

const createSourceSchema = z.object({
  platform: platformEnum,
  identifier: z.string().trim().min(1),
  label: z.string().trim().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const updateSourceSchema = z.object({
  identifier: z.string().trim().min(1).optional(),
  label: z.string().trim().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const secretSchema = z.record(z.string(), z.string());

const createConnectorSchema = z
  .object({
    platform: platformEnum,
    authKind: z.enum(['oauth', 'scrape']),
    label: z.string().trim().optional(),
    priority: z.number().int().min(0).optional(),
    enabled: z.boolean().optional(),
    secret: secretSchema,
  })
  .superRefine((d, ctx) => {
    if (d.authKind === 'oauth') {
      for (const k of ['clientId', 'clientSecret', 'username', 'password', 'userAgent']) {
        if (!d.secret[k]?.trim()) {
          ctx.addIssue({ code: 'custom', message: `oauth 凭据缺少 ${k}`, path: ['secret', k] });
        }
      }
    }
  });

const updateConnectorSchema = z.object({
  label: z.string().trim().optional(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  secret: secretSchema.optional(),
});

/**
 * /api/sources/* —— 采集来源（爬虫计划）CRUD + 概览。
 * 编排与 Reddit 服务端闸在 {@link SourcesService}；本控制器仅做入参校验与结果对象 → HTTP 翻译。
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('settings:manage')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  /** GET /api/sources —— 来源列表 + 连接器（脱敏）+ redditUsable + secretConfigured */
  @Get()
  overview() {
    return this.sources.overview();
  }

  /** POST /api/sources —— 新建来源，201 { id } */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createSourceSchema)) dto: z.infer<typeof createSourceSchema>,
  ) {
    const res = await this.sources.createSource(dto);
    if (!res.ok) throw new HttpException(res.message, res.status);
    return { id: res.id };
  }

  /** PUT /api/sources/:id —— 更新来源（含勾选 enabled，走 Reddit 门禁） */
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateSourceSchema)) dto: z.infer<typeof updateSourceSchema>,
  ) {
    const res = await this.sources.updateSource(id, dto);
    if (!res.ok) throw new HttpException(res.message, res.status);
    return { ok: true };
  }

  /** DELETE /api/sources/:id */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const res = await this.sources.deleteSource(id);
    if (!res.ok) throw new HttpException(res.message, res.status);
    return { ok: true };
  }
}

/**
 * /api/source-connectors/* —— 采集连接器（需鉴权平台的凭据）CRUD + 连通性测试。
 * 凭据加密入库、仅脱敏外发；改 secret 会清空上次测试结果（须重测才可用）。
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('settings:manage')
@Controller('source-connectors')
export class SourceConnectorsController {
  constructor(private readonly sources: SourcesService) {}

  /** POST /api/source-connectors —— 新建连接器（凭据加密入库），201 { id } */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createConnectorSchema)) dto: z.infer<typeof createConnectorSchema>,
  ) {
    const input: ConnectorInput = {
      platform: dto.platform,
      authKind: dto.authKind,
      secret: dto.secret,
      label: dto.label,
      priority: dto.priority,
      enabled: dto.enabled,
    };
    const res = await this.sources.createConnector(input);
    if (!res.ok) throw new HttpException(res.message, res.status);
    return { id: res.id };
  }

  /** PUT /api/source-connectors/:id —— 更新（改 secret 会清空测试结果，须重测） */
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateConnectorSchema)) dto: z.infer<typeof updateConnectorSchema>,
  ) {
    const res = await this.sources.updateConnector(id, dto);
    if (!res.ok) throw new HttpException(res.message, res.status);
    return { ok: true };
  }

  /** DELETE /api/source-connectors/:id */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const res = await this.sources.deleteConnector(id);
    if (!res.ok) throw new HttpException(res.message, res.status);
    return { ok: true };
  }

  /** POST /api/source-connectors/:id/test —— 连通性测试并记录结果，始终 200 + { ok, error? } */
  @Post(':id/test')
  async test(@Param('id', ParseIntPipe) id: number) {
    return this.sources.testConnector(id);
  }
}
