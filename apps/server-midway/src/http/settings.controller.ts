import { Controller, Del, Get, HttpCode, httpError, Inject, Post, Put, UseGuard } from '@midwayjs/core';
import { z } from 'zod';
import {
  isSecretConfigured,
  nowSec,
  toProviderDTO,
  type AnalysisConfigService,
  type KeyInput,
  type KeyUpdate,
  type ProviderInput,
  type ProvidersRepository,
  type RuntimeSettingsPatch,
  type RuntimeSettingsService,
  type SettingsRepository,
} from '@hatch-radar/core';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { IntParam, ValidBody } from '@/common/params';
import { TOK } from '@/common/tokens';
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

const createKeySchema = z.object({
  apiKey: z.string().trim().min(1),
  label: z.string().trim().optional(),
  priority: z.number().int().min(0).optional(),
});

const updateKeySchema = z.object({
  label: z.string().trim().optional(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  /** 把 cooling/invalid 的 Key 复位为 active（人工排障后恢复使用） */
  reset: z.boolean().optional(),
});

const activeSchema = z.object({ providerId: z.number().int().nullable() });

/**
 * 运行期参数写入入参：每项可省略（不变）/ 给整数（写入）。下界与 RuntimeSettingsService 一致。
 */
const runtimeSettingsSchema = z
  .object({
    analyzeBatchSize: z.number().int().min(1),
    sessionIdleDays: z.number().int().min(1),
    sessionAbsoluteDays: z.number().int().min(1),
    workerJobTimeoutMs: z.number().int().min(1000),
    workerStaleSeconds: z.number().int().min(30),
  })
  .partial();

/** '' / 仅空白的 baseUrl 归一化为 undefined（不存空串） */
function normalizeBaseUrl(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * /api/settings/* —— 模型清单 CRUD + Key 池管理 + 选用 active（密钥加密入库，仅脱敏外发）。
 * 与 NestJS 版逐一对齐：:id/:keyId 走 IntParam（非整数 400）；POST 默认 201（含各 /test 端点）。
 */
@UseGuard(SessionAuthGuard)
@RequirePermission('settings:manage')
@Controller('/settings')
export class SettingsController {
  @Inject(TOK.providers)
  providers!: ProvidersRepository;

  @Inject(TOK.settings)
  settings!: SettingsRepository;

  @Inject(TOK.analysisConfig)
  analysisConfig!: AnalysisConfigService;

  @Inject(TOK.runtimeSettings)
  runtimeSettings!: RuntimeSettingsService;

  // ── 运行期可调项 ──────────────────────────────────────────────────────

  /** GET /api/settings/runtime —— 五项运行期可调项有效态 */
  @Get('/runtime')
  runtime() {
    return this.runtimeSettings.getOverview();
  }

  /** PUT /api/settings/runtime —— 写入运行期参数（整数），保存即生效。 */
  @Put('/runtime')
  async updateRuntime(@ValidBody(runtimeSettingsSchema) dto: z.infer<typeof runtimeSettingsSchema>) {
    return await this.runtimeSettings.applySettings(dto satisfies RuntimeSettingsPatch);
  }

  /** GET /api/settings —— providers（含 Key 池脱敏）+ activeProviderId + secretConfigured */
  @Get('/')
  async overview() {
    return {
      providers: (await this.providers.listProvidersWithKeys()).map(toProviderDTO),
      activeProviderId: await this.settings.getActiveProviderId(),
      secretConfigured: isSecretConfigured(),
    };
  }

  /** GET /api/settings/providers —— 模型清单（含 Key 池脱敏） */
  @Get('/providers')
  async list() {
    return (await this.providers.listProvidersWithKeys()).map(toProviderDTO);
  }

  /** POST /api/settings/providers —— 新建模型（含第一把 Key，密钥加密入库），201 { id } */
  @Post('/providers')
  @HttpCode(201)
  async create(@ValidBody(createSchema) dto: z.infer<typeof createSchema>) {
    if (!isSecretConfigured()) {
      throw new httpError.BadRequestError('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
    }
    const { apiKey, baseUrl, ...rest } = dto;
    const input: ProviderInput = { ...rest, baseUrl: normalizeBaseUrl(baseUrl) };
    const id = await this.providers.createProvider(input, apiKey, nowSec());
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 新增模型 #${id}：${dto.provider} (${dto.model})`);
    return { id };
  }

  /** PUT /api/settings/providers/:id —— 更新模型标量字段（密钥走 Key 池端点）。 */
  @Put('/providers/:id')
  async update(@IntParam('id') id: number, @ValidBody(updateSchema) dto: z.infer<typeof updateSchema>) {
    if (dto.apiKey && !isSecretConfigured()) {
      throw new httpError.BadRequestError('未配置 SETTINGS_SECRET，无法加密新密钥');
    }
    const existing = await this.providers.getProvider(id);
    if (!existing) throw new httpError.NotFoundError('模型配置不存在');

    const { apiKey, ...scalarDto } = dto;
    const fields: Partial<ProviderInput> = { ...scalarDto };
    if (dto.baseUrl !== undefined) fields.baseUrl = normalizeBaseUrl(dto.baseUrl);

    const nextBaseUrl =
      dto.baseUrl !== undefined ? (fields.baseUrl ?? null) : (existing.base_url ?? null);
    const baseUrlChanged = (existing.base_url ?? null) !== nextBaseUrl;

    if (baseUrlChanged) {
      if (!apiKey) {
        throw new httpError.BadRequestError(
          '修改 baseUrl 时必须同时重新填写 API Key（旧 Key 将被清空，避免被发往新地址）',
        );
      }
      await this.providers.updateProviderAndResetKeys(id, fields, apiKey, nowSec());
    } else if (Object.keys(fields).length > 0) {
      await this.providers.updateProvider(id, fields, nowSec());
    }
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 更新模型 #${id}${baseUrlChanged ? '（baseUrl 变更，Key 池已重置）' : ''}`);
    return { ok: true };
  }

  /** DELETE /api/settings/providers/:id —— 删除模型（Key 池级联删除；若为 active 则清空 active） */
  @Del('/providers/:id')
  async remove(@IntParam('id') id: number) {
    const removed = await this.providers.deleteProvider(id);
    if (!removed) throw new httpError.NotFoundError('模型配置不存在');
    if ((await this.settings.getActiveProviderId()) === id) {
      await this.settings.setActiveProviderId(null);
    }
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 删除模型 #${id}`);
    return { ok: true };
  }

  /** POST /api/settings/providers/:id/test —— 探测连通性，始终 { ok, error? }（201）。 */
  @Post('/providers/:id/test')
  @HttpCode(201)
  async test(@IntParam('id') id: number) {
    return this.analysisConfig.testProvider(id);
  }

  // ── API Key 池 ────────────────────────────────────────────────────────

  /** POST /api/settings/providers/:id/keys —— 新增一把备用 Key（密钥加密入库），201 { id } */
  @Post('/providers/:id/keys')
  @HttpCode(201)
  async addKey(@IntParam('id') providerId: number, @ValidBody(createKeySchema) dto: z.infer<typeof createKeySchema>) {
    if (!isSecretConfigured()) {
      throw new httpError.BadRequestError('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
    }
    if (!(await this.providers.getProvider(providerId))) {
      throw new httpError.NotFoundError('模型配置不存在');
    }
    const id = await this.providers.createKey(providerId, dto satisfies KeyInput, nowSec());
    logger.info(`[设置] 模型 #${providerId} 新增 Key #${id}`);
    return { id };
  }

  /** PUT /api/settings/providers/:id/keys/:keyId —— 改备注/优先级/启停；reset 复位 invalid/cooling */
  @Put('/providers/:id/keys/:keyId')
  async updateKey(
    @IntParam('id') providerId: number,
    @IntParam('keyId') keyId: number,
    @ValidBody(updateKeySchema) dto: z.infer<typeof updateKeySchema>,
  ) {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) throw new httpError.NotFoundError('API Key 不存在');
    if (Object.keys(dto).length > 0) await this.providers.updateKey(keyId, dto satisfies KeyUpdate, nowSec());
    return { ok: true };
  }

  /** DELETE /api/settings/providers/:id/keys/:keyId —— 删除一把 Key */
  @Del('/providers/:id/keys/:keyId')
  async removeKey(@IntParam('id') providerId: number, @IntParam('keyId') keyId: number) {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) throw new httpError.NotFoundError('API Key 不存在');
    await this.providers.deleteKey(keyId);
    logger.info(`[设置] 模型 #${providerId} 删除 Key #${keyId}`);
    return { ok: true };
  }

  /** POST /api/settings/providers/:id/keys/:keyId/test —— 测试指定 Key，始终 { ok, error? }（201） */
  @Post('/providers/:id/keys/:keyId/test')
  @HttpCode(201)
  async testKey(@IntParam('id') providerId: number, @IntParam('keyId') keyId: number) {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) throw new httpError.NotFoundError('API Key 不存在');
    return this.analysisConfig.testProviderKey(keyId);
  }

  /** PUT /api/settings/active —— 选用模型 { providerId: number|null }，即时热重载并触发一轮入队 */
  @Put('/active')
  async setActive(@ValidBody(activeSchema) dto: z.infer<typeof activeSchema>) {
    if (dto.providerId !== null) {
      const row = await this.providers.getProvider(dto.providerId);
      if (!row) throw new httpError.NotFoundError('模型配置不存在');
      if (!row.enabled) throw new httpError.BadRequestError('该模型已停用，无法设为 active');
      if ((await this.providers.countUsableKeys(dto.providerId, nowSec())) === 0) {
        throw new httpError.BadRequestError('该模型无可用 API Key，请先添加或复位后再设为启用');
      }
    }
    await this.settings.setActiveProviderId(dto.providerId);
    await this.analysisConfig.reloadAnalysisConfig();
    const round = await this.analysisConfig.enqueueAutoAnalysisRound(
      await this.runtimeSettings.getAnalyzeBatchSize(),
    );
    logger.info(`[设置] active 模型 → ${dto.providerId ?? '（清空）'}；即时入队 ${round.enqueued} 篇`);
    return { activeProviderId: dto.providerId, enqueued: round.enqueued };
  }
}
