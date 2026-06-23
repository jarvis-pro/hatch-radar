import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '@/modules/account/auth-user.decorator';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { type ConnectorInput } from '@/database';
import { SourcesService } from '@/modules/sources/sources.service';

/** 采集平台：Reddit / HackerNews / RSS。 */
const platformEnum = z.enum(['reddit', 'hackernews', 'rss']);

/** 新建采集来源（爬虫计划）入参。 */
const createSourceSchema = z.object({
  /** 来源所属平台 */
  platform: platformEnum,
  /** 来源标识（版块名 / RSS 地址 / 频道），非空 */
  identifier: z.string().trim().min(1),
  /** 展示名；省略=用 identifier */
  label: z.string().trim().optional(),
  /** 平台特定配置（如抓取范围 / 排序），自由 KV；省略=默认 */
  config: z.record(z.string(), z.unknown()).optional(),
  /** 是否启用采集；省略走服务默认 */
  enabled: z.boolean().optional(),
});

/** 更新采集来源入参：每项可省略（不改）。 */
const updateSourceSchema = z.object({
  /** 改来源标识（非空）；省略=不改 */
  identifier: z.string().trim().min(1).optional(),
  /** 改展示名；省略=不改 */
  label: z.string().trim().optional(),
  /** 改平台配置（整体覆盖）；省略=不改 */
  config: z.record(z.string(), z.unknown()).optional(),
  /** 改启停（启用走 Reddit 门禁）；省略=不改 */
  enabled: z.boolean().optional(),
});

/** 连接器凭据：自由字符串 KV（如 clientId/clientSecret/...），加密入库后仅脱敏外发。 */
const secretSchema = z.record(z.string(), z.string());

/** 新建采集连接器入参：平台 + 鉴权方式 + 凭据（oauth 凭据完整性见 superRefine）。 */
const createConnectorSchema = z
  .object({
    /** 连接器服务的平台 */
    platform: platformEnum,
    /** 鉴权方式：oauth（官方 API 凭据）/ scrape（爬虫，无需凭据） */
    authKind: z.enum(['oauth', 'scrape']),
    /** 展示名；省略=自动命名 */
    label: z.string().trim().optional(),
    /** 故障转移优先级，数字越小越优先；省略走服务默认 */
    priority: z.number().int().min(0).optional(),
    /** 是否启用；省略走服务默认 */
    enabled: z.boolean().optional(),
    /** 凭据 KV（加密入库）；oauth 必须含 clientId/clientSecret/username/password/userAgent */
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

/** 更新采集连接器入参：每项可省略（不改）；改 secret 会清空上次测试结果。 */
const updateConnectorSchema = z.object({
  /** 改展示名；省略=不改 */
  label: z.string().trim().optional(),
  /** 改优先级；省略=不改 */
  priority: z.number().int().min(0).optional(),
  /** 改启停；省略=不改 */
  enabled: z.boolean().optional(),
  /** 改凭据（整体覆盖，加密入库，清空测试结果须重测）；省略=不改 */
  secret: secretSchema.optional(),
});

/**
 * /api/sources/* —— 采集来源（爬虫计划）CRUD + 概览。
 * 编排与 Reddit 服务端闸在 {@link SourcesService}；本控制器仅做入参校验，业务失败由服务抛 DomainError。
 */
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
    return this.sources.createSource(dto);
  }

  /** PUT /api/sources/:id —— 更新来源（含勾选 enabled，走 Reddit 门禁） */
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateSourceSchema)) dto: z.infer<typeof updateSourceSchema>,
  ) {
    await this.sources.updateSource(id, dto);

    return { ok: true };
  }

  /** DELETE /api/sources/:id */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.sources.deleteSource(id);

    return { ok: true };
  }
}

/**
 * /api/source-connectors/* —— 采集连接器（需鉴权平台的凭据）CRUD + 连通性测试。
 * 凭据加密入库、仅脱敏外发；改 secret 会清空上次测试结果（须重测才可用）。
 */
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

    return this.sources.createConnector(input);
  }

  /** PUT /api/source-connectors/:id —— 更新（改 secret 会清空测试结果，须重测） */
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateConnectorSchema)) dto: z.infer<typeof updateConnectorSchema>,
  ) {
    await this.sources.updateConnector(id, dto);

    return { ok: true };
  }

  /** DELETE /api/source-connectors/:id */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.sources.deleteConnector(id);

    return { ok: true };
  }

  /** POST /api/source-connectors/:id/test —— 连通性测试并记录结果，始终 200 + { ok, error? } */
  @Post(':id/test')
  async test(@Param('id', ParseIntPipe) id: number) {
    return this.sources.testConnector(id);
  }
}
