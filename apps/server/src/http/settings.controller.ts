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
import { AnalysisConfigService } from '@/analysis/analysis-config.service';
import { BearerAuthGuard } from '@/common/bearer-auth.guard';
import { nowSec } from '@/utils/time';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { isSecretConfigured } from '@/utils/crypto';
import { ProvidersRepository, toProviderDTO, type ProviderInput } from '@/db/providers.repository';
import { SettingsRepository } from '@/db/settings.repository';
import { logger } from '@/logger';

const providerKind = z.enum(['anthropic', 'openai', 'deepseek']);

const createSchema = z.object({
  provider: providerKind,
  label: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  baseUrl: z.string().trim().optional(),
  model: z.string().trim().min(1),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  provider: providerKind.optional(),
  label: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  model: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
});

const activeSchema = z.object({ providerId: z.number().int().nullable() });

/** '' / 仅空白的 baseUrl 归一化为 undefined（不存空串） */
function normalizeBaseUrl(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * /api/settings/* —— 模型清单 CRUD + 选用 active（密钥加密入库，仅脱敏外发）。
 * 任意写操作后调用 reloadAnalysisConfig() 使配置即时生效（无需重启进程）。
 */
@UseGuards(BearerAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
    private readonly analysisConfig: AnalysisConfigService,
  ) {}

  /** GET /api/settings —— providers（脱敏）+ activeProviderId + secretConfigured */
  @Get()
  async overview() {
    const list = await this.providers.listProviders();
    return {
      providers: list.map(toProviderDTO),
      activeProviderId: await this.settings.getActiveProviderId(),
      secretConfigured: isSecretConfigured(),
    };
  }

  /** GET /api/settings/providers —— 模型清单（脱敏） */
  @Get('providers')
  async list() {
    return (await this.providers.listProviders()).map(toProviderDTO);
  }

  /** POST /api/settings/providers —— 新建模型（密钥加密入库），201 { id } */
  @Post('providers')
  async create(@Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    if (!isSecretConfigured()) {
      throw new BadRequestException('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
    }
    const input: ProviderInput = { ...dto, baseUrl: normalizeBaseUrl(dto.baseUrl) };
    const id = await this.providers.createProvider(input, nowSec());
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 新增模型 #${id}：${dto.provider} (${dto.model})`);
    return { id };
  }

  /** PUT /api/settings/providers/:id —— 更新模型（apiKey 留空则保留原值） */
  @Put('providers/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateSchema)) dto: z.infer<typeof updateSchema>,
  ) {
    if (dto.apiKey && !isSecretConfigured()) {
      throw new BadRequestException('未配置 SETTINGS_SECRET，无法加密新密钥');
    }
    const existing = await this.providers.getProvider(id);
    if (!existing) throw new NotFoundException('模型配置不存在');

    const fields: Partial<ProviderInput> = { ...dto };
    if (dto.baseUrl !== undefined) fields.baseUrl = normalizeBaseUrl(dto.baseUrl);

    // 安全闸：改 baseUrl 必须同时重填 API Key。否则攻击者可只改 baseUrl（不带 key），
    // 让 test / 分析调用把已入库的明文密钥发往任意地址——局域网默认免鉴权时尤其危险，
    // 会瓦解「密钥加密入库」的全部意义。重填 key 时旧 key 被覆盖，无可窃取。
    const nextBaseUrl =
      dto.baseUrl !== undefined ? (fields.baseUrl ?? null) : (existing.base_url ?? null);
    if ((existing.base_url ?? null) !== nextBaseUrl && !dto.apiKey) {
      throw new BadRequestException(
        '修改 baseUrl 时必须同时重新填写 API Key（避免旧密钥被发往新地址）',
      );
    }

    const ok = await this.providers.updateProvider(id, fields, nowSec());
    if (!ok) throw new NotFoundException('模型配置不存在或无字段可更新');
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 更新模型 #${id}`);
    return { ok: true };
  }

  /** DELETE /api/settings/providers/:id —— 删除模型（若为 active 则同时清空 active） */
  @Delete('providers/:id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const removed = await this.providers.deleteProvider(id);
    if (!removed) throw new NotFoundException('模型配置不存在');
    if ((await this.settings.getActiveProviderId()) === id) {
      await this.settings.setActiveProviderId(null);
    }
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 删除模型 #${id}`);
    return { ok: true };
  }

  /**
   * POST /api/settings/providers/:id/test —— 连通性探测，始终 200 + { ok, error? }。
   * 探测结果（连不连得上）是响应数据、不是请求错误，故不抛异常 / 不置 4xx。
   */
  @Post('providers/:id/test')
  async test(@Param('id', ParseIntPipe) id: number) {
    return this.analysisConfig.testProvider(id);
  }

  /** PUT /api/settings/active —— 选用模型 { providerId: number|null }，即时热重载并触发一轮入队 */
  @Put('active')
  async setActive(@Body(new ZodValidationPipe(activeSchema)) dto: z.infer<typeof activeSchema>) {
    if (dto.providerId !== null) {
      const row = await this.providers.getProvider(dto.providerId);
      if (!row) throw new NotFoundException('模型配置不存在');
      if (!row.enabled) throw new BadRequestException('该模型已停用，无法设为 active');
    }
    await this.settings.setActiveProviderId(dto.providerId);
    await this.analysisConfig.reloadAnalysisConfig();
    // 即时生效：选用后立刻入一轮队，无需等下一次定时调度
    const round = await this.analysisConfig.enqueueAutoAnalysisRound();
    logger.info(
      `[设置] active 模型 → ${dto.providerId ?? '（清空）'}；即时入队 ${round.enqueued} 篇`,
    );
    return { activeProviderId: dto.providerId, enqueued: round.enqueued };
  }
}
