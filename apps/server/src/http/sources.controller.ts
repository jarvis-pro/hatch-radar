import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { BearerAuthGuard } from '@/common/bearer-auth.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { isSecretConfigured } from '@/utils/crypto';
import { nowSec } from '@/utils/time';
import { CrawlerConfigService } from '@/crawler/crawler-config.service';
import {
  SourceConnectorsRepository,
  toConnectorDTO,
  type ConnectorInput,
} from '@/db/source-connectors.repository';
import { SourcesRepository, type SourcePlatform } from '@/db/sources.repository';
import { logger } from '@/logger';

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
 * Reddit 门禁（服务端闸）：平台=reddit 的来源置 enabled=true 须存在「可用 reddit 连接器」。
 */
@UseGuards(BearerAuthGuard)
@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sources: SourcesRepository,
    private readonly connectors: SourceConnectorsRepository,
  ) {}

  /** GET /api/sources —— 来源列表 + 连接器（脱敏）+ redditUsable + secretConfigured */
  @Get()
  async overview() {
    const [sourceRows, connectorRows, redditUsable] = await Promise.all([
      this.sources.listSources(),
      this.connectors.listConnectors(),
      this.connectors.hasUsableConnector('reddit'),
    ]);
    return {
      sources: sourceRows,
      connectors: connectorRows.map(toConnectorDTO),
      redditUsable,
      secretConfigured: isSecretConfigured(),
    };
  }

  /** POST /api/sources —— 新建来源，201 { id } */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createSourceSchema)) dto: z.infer<typeof createSourceSchema>,
  ) {
    await this.assertRedditEnable(dto.platform, dto.enabled !== false);
    const id = await this.sources.createSource(dto, nowSec());
    logger.info(`[数据来源] 新增 #${id}：${dto.platform}/${dto.identifier}`);
    return { id };
  }

  /** PUT /api/sources/:id —— 更新来源（含勾选 enabled，走 Reddit 门禁） */
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateSourceSchema)) dto: z.infer<typeof updateSourceSchema>,
  ) {
    const existing = await this.sources.getSource(id);
    if (!existing) throw new NotFoundException('来源不存在');
    if (dto.enabled === true) await this.assertRedditEnable(existing.platform, true);
    if (Object.keys(dto).length > 0) await this.sources.updateSource(id, dto, nowSec());
    return { ok: true };
  }

  /** DELETE /api/sources/:id */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    if (!(await this.sources.deleteSource(id))) throw new NotFoundException('来源不存在');
    logger.info(`[数据来源] 删除 #${id}`);
    return { ok: true };
  }

  /** Reddit 门禁：平台=reddit 的来源要置 enabled=true，必须已有「可用 reddit 连接器」 */
  private async assertRedditEnable(platform: SourcePlatform, enabling: boolean): Promise<void> {
    if (
      platform === 'reddit' &&
      enabling &&
      !(await this.connectors.hasUsableConnector('reddit'))
    ) {
      throw new BadRequestException(
        'Reddit 来源需先在「采集连接器」配置并测试通过 Reddit 凭据，才能启用',
      );
    }
  }
}

/**
 * /api/source-connectors/* —— 采集连接器（需鉴权平台的凭据）CRUD + 连通性测试。
 * 凭据加密入库、仅脱敏外发；改 secret 会清空上次测试结果（须重测才可用）。
 */
@UseGuards(BearerAuthGuard)
@Controller('source-connectors')
export class SourceConnectorsController {
  constructor(
    private readonly connectors: SourceConnectorsRepository,
    private readonly crawlerConfig: CrawlerConfigService,
  ) {}

  /** POST /api/source-connectors —— 新建连接器（凭据加密入库），201 { id } */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createConnectorSchema)) dto: z.infer<typeof createConnectorSchema>,
  ) {
    if (!isSecretConfigured()) {
      throw new BadRequestException('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
    }
    const input: ConnectorInput = {
      platform: dto.platform,
      authKind: dto.authKind,
      secret: dto.secret,
      label: dto.label,
      priority: dto.priority,
      enabled: dto.enabled,
    };
    const id = await this.connectors.createConnector(input, nowSec());
    logger.info(`[采集连接器] 新增 #${id}：${dto.platform}/${dto.authKind}`);
    return { id };
  }

  /** PUT /api/source-connectors/:id —— 更新（改 secret 会清空测试结果，须重测） */
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateConnectorSchema)) dto: z.infer<typeof updateConnectorSchema>,
  ) {
    if (dto.secret && !isSecretConfigured()) {
      throw new BadRequestException('未配置 SETTINGS_SECRET，无法加密新凭据');
    }
    if (!(await this.connectors.getConnector(id))) throw new NotFoundException('连接器不存在');
    if (Object.keys(dto).length > 0) await this.connectors.updateConnector(id, dto, nowSec());
    logger.info(`[采集连接器] 更新 #${id}`);
    return { ok: true };
  }

  /** DELETE /api/source-connectors/:id */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    if (!(await this.connectors.deleteConnector(id))) throw new NotFoundException('连接器不存在');
    logger.info(`[采集连接器] 删除 #${id}`);
    return { ok: true };
  }

  /** POST /api/source-connectors/:id/test —— 连通性测试并记录结果，始终 200 + { ok, error? } */
  @Post(':id/test')
  async test(@Param('id', ParseIntPipe) id: number) {
    return this.crawlerConfig.testConnector(id);
  }
}
