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
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import {
  AnalysisConfigService,
  RuntimeSettingsService,
  type RuntimeSettingsPatch,
  nowSec,
  isSecretConfigured,
  ProvidersRepository,
  toProviderDTO,
  type KeyInput,
  type KeyUpdate,
  type ProviderInput,
  SettingsRepository,
} from '@/domain';
import { logger } from '@/logger';

const providerKind = z.enum(['anthropic', 'openai', 'deepseek', 'claude_cli', 'azure']);

const createSchema = z.object({
  provider: providerKind,
  label: z.string().trim().min(1),
  /** claude_cli 订阅模式无需 Key（复用本机登录态）；其余 provider 在 handler 内强制必填 */
  apiKey: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().optional(),
  /** Azure Translator 资源区域（如 eastasia）；仅 azure 用 */
  region: z.string().trim().optional(),
  model: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  /** token 单价（美元 / 1M tokens）；省略=不设，用于成本核算 */
  inputPrice: z.number().nonnegative().nullable().optional(),
  outputPrice: z.number().nonnegative().nullable().optional(),
});

const updateSchema = z.object({
  provider: providerKind.optional(),
  label: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  /** Azure Translator 资源区域；仅 azure 用，'' 清除 */
  region: z.string().trim().optional(),
  model: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  /** token 单价（美元 / 1M tokens）；null=清除、省略=不改 */
  inputPrice: z.number().nonnegative().nullable().optional(),
  outputPrice: z.number().nonnegative().nullable().optional(),
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
 * 运行期参数写入入参：每项可省略（不变）/ 给整数（写入）。下界与 RuntimeSettingsService 一致，
 * 避免从设置页填出会让 worker / 会话失常的值。「恢复默认」由前端以默认值发起，等同普通写入。
 */
const runtimeSettingsSchema = z
  .object({
    analyzeBatchSize: z.number().int().min(1),
    sessionIdleDays: z.number().int().min(1),
    sessionAbsoluteDays: z.number().int().min(1),
    workerJobTimeoutMs: z.number().int().min(1000),
    workerStaleSeconds: z.number().int().min(30),
    translationConcurrency: z.number().int().min(1),
  })
  .partial();

/** '' / 仅空白的 baseUrl 归一化为 undefined（不存空串） */
function normalizeBaseUrl(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * /api/settings/* —— 模型清单 CRUD + Key 池管理 + 选用 active（密钥加密入库，仅脱敏外发）。
 * 任意写操作后调用 reloadAnalysisConfig() 使配置即时生效（无需重启进程）；Key 增删/启停因
 * 每次分析实时查库，本就即时生效，故不强制 reload。
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('settings:manage')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  // ── 运行期可调项（分析批次 / 会话时长 / worker 调优；DB 覆盖优先、env 默认兜底）────────

  /** GET /api/settings/runtime —— 五项运行期可调项有效态（当前值 / env 默认 / 是否覆盖） */
  @Get('runtime')
  runtime() {
    return this.runtimeSettings.getOverview();
  }

  /**
   * PUT /api/settings/runtime —— 写入运行期参数（整数），保存即生效。
   * 实时读库故无需重启或版本广播；独立 worker 进程下一次回收/分发即采用新值。
   */
  @Put('runtime')
  updateRuntime(
    @Body(new ZodValidationPipe(runtimeSettingsSchema))
    dto: z.infer<typeof runtimeSettingsSchema>,
  ) {
    return this.runtimeSettings.applySettings(dto satisfies RuntimeSettingsPatch);
  }

  /** GET /api/settings —— providers（含 Key 池脱敏）+ activeProviderId + secretConfigured */
  @Get()
  async overview() {
    return {
      providers: (await this.providers.listProvidersWithKeys()).map(toProviderDTO),
      activeProviderId: await this.settings.getActiveProviderId(),
      translationProviderId: await this.settings.getTranslationProviderId(),
      secretConfigured: isSecretConfigured(),
    };
  }

  /** GET /api/settings/providers —— 模型清单（含 Key 池脱敏） */
  @Get('providers')
  async list() {
    return (await this.providers.listProvidersWithKeys()).map(toProviderDTO);
  }

  /** POST /api/settings/providers —— 新建模型（含第一把 Key，密钥加密入库），201 { id } */
  @Post('providers')
  async create(@Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    const isCli = dto.provider === 'claude_cli';
    if (!isCli) {
      if (!dto.apiKey) throw new BadRequestException('该模型必须提供 API Key');
      if (!isSecretConfigured()) {
        throw new BadRequestException('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
      }
    }
    const { apiKey, baseUrl, ...rest } = dto;
    // claude_cli 订阅模式：无 base_url、无 Key（复用本机已登录的 claude）
    const input: ProviderInput = { ...rest, baseUrl: isCli ? null : normalizeBaseUrl(baseUrl) };
    const id = await this.providers.createProvider(
      input,
      isCli ? null : (apiKey ?? null),
      nowSec(),
    );
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 新增模型 #${id}：${dto.provider} (${dto.model})`);
    return { id };
  }

  /**
   * PUT /api/settings/providers/:id —— 更新模型标量字段（密钥走 Key 池端点）。
   * 安全闸：改 baseUrl 必须同时重填 API Key——否则旧密钥会被发往新地址。重填时整个 Key 池
   * 被替换成这一把新 Key（旧 Key 全清，无可窃取）；baseUrl 不变时 apiKey 不参与（去 Key 池端点管）。
   */
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

    // claude_cli 订阅模式：无 base_url / 无 Key，仅更新标量字段，跳过「改 baseUrl 须重填 Key」安全闸
    if ((dto.provider ?? existing.provider) === 'claude_cli') {
      const fields: Partial<ProviderInput> = { baseUrl: null };
      if (dto.provider !== undefined) fields.provider = dto.provider;
      if (dto.label !== undefined) fields.label = dto.label;
      if (dto.model !== undefined) fields.model = dto.model;
      if (dto.enabled !== undefined) fields.enabled = dto.enabled;
      if (dto.inputPrice !== undefined) fields.inputPrice = dto.inputPrice;
      if (dto.outputPrice !== undefined) fields.outputPrice = dto.outputPrice;
      await this.providers.updateProvider(id, fields, nowSec());
      await this.analysisConfig.reloadAnalysisConfig();
      logger.info(`[设置] 更新模型 #${id}（订阅模式）`);
      return { ok: true };
    }

    // azure（机翻）：单把 Key、不走多 Key 池——提供 apiKey 即整体替换那把 Key，否则仅改标量字段
    if ((dto.provider ?? existing.provider) === 'azure') {
      const { apiKey: azureKey, ...azureScalar } = dto;
      const fields: Partial<ProviderInput> = { ...azureScalar };
      if (azureKey) {
        if (!isSecretConfigured()) {
          throw new BadRequestException('未配置 SETTINGS_SECRET，无法加密新密钥');
        }
        await this.providers.updateProviderAndResetKeys(id, fields, azureKey, nowSec());
      } else if (Object.keys(fields).length > 0) {
        await this.providers.updateProvider(id, fields, nowSec());
      }
      await this.analysisConfig.reloadAnalysisConfig();
      logger.info(`[设置] 更新 Azure 翻译模型 #${id}${azureKey ? '（已更换 Key）' : ''}`);
      return { ok: true };
    }

    const { apiKey, ...scalarDto } = dto;
    const fields: Partial<ProviderInput> = { ...scalarDto };
    if (dto.baseUrl !== undefined) fields.baseUrl = normalizeBaseUrl(dto.baseUrl);

    const nextBaseUrl =
      dto.baseUrl !== undefined ? (fields.baseUrl ?? null) : (existing.base_url ?? null);
    const baseUrlChanged = (existing.base_url ?? null) !== nextBaseUrl;

    if (baseUrlChanged) {
      if (!apiKey) {
        throw new BadRequestException(
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
   * POST /api/settings/providers/:id/test —— 用最优可用 Key 探测连通性，始终 200 + { ok, error? }。
   */
  @Post('providers/:id/test')
  async test(@Param('id', ParseIntPipe) id: number) {
    return this.analysisConfig.testProvider(id);
  }

  // ── API Key 池 ────────────────────────────────────────────────────────

  /** POST /api/settings/providers/:id/keys —— 新增一把备用 Key（密钥加密入库），201 { id } */
  @Post('providers/:id/keys')
  async addKey(
    @Param('id', ParseIntPipe) providerId: number,
    @Body(new ZodValidationPipe(createKeySchema)) dto: z.infer<typeof createKeySchema>,
  ) {
    if (!isSecretConfigured()) {
      throw new BadRequestException('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
    }
    const provider = await this.providers.getProvider(providerId);
    if (!provider) throw new NotFoundException('模型配置不存在');
    if (provider.provider === 'claude_cli') {
      throw new BadRequestException('订阅模式（Claude CLI）复用本机登录态，无需也不支持 API Key');
    }
    if (provider.provider === 'azure') {
      throw new BadRequestException('Azure 翻译仅用单把 Key，请用「编辑模型」更换，不走多 Key 池');
    }
    const id = await this.providers.createKey(providerId, dto satisfies KeyInput, nowSec());
    logger.info(`[设置] 模型 #${providerId} 新增 Key #${id}`);
    return { id };
  }

  /** PUT /api/settings/providers/:id/keys/:keyId —— 改备注/优先级/启停；reset 复位 invalid/cooling */
  @Put('providers/:id/keys/:keyId')
  async updateKey(
    @Param('id', ParseIntPipe) providerId: number,
    @Param('keyId', ParseIntPipe) keyId: number,
    @Body(new ZodValidationPipe(updateKeySchema)) dto: z.infer<typeof updateKeySchema>,
  ) {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) throw new NotFoundException('API Key 不存在');
    if (Object.keys(dto).length > 0)
      await this.providers.updateKey(keyId, dto satisfies KeyUpdate, nowSec());
    return { ok: true };
  }

  /** DELETE /api/settings/providers/:id/keys/:keyId —— 删除一把 Key */
  @Delete('providers/:id/keys/:keyId')
  async removeKey(
    @Param('id', ParseIntPipe) providerId: number,
    @Param('keyId', ParseIntPipe) keyId: number,
  ) {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) throw new NotFoundException('API Key 不存在');
    await this.providers.deleteKey(keyId);
    logger.info(`[设置] 模型 #${providerId} 删除 Key #${keyId}`);
    return { ok: true };
  }

  /** POST /api/settings/providers/:id/keys/:keyId/test —— 测试指定 Key，始终 200 + { ok, error? } */
  @Post('providers/:id/keys/:keyId/test')
  async testKey(
    @Param('id', ParseIntPipe) providerId: number,
    @Param('keyId', ParseIntPipe) keyId: number,
  ) {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) throw new NotFoundException('API Key 不存在');
    return this.analysisConfig.testProviderKey(keyId);
  }

  /** PUT /api/settings/active —— 选用模型 { providerId: number|null }，即时热重载并触发一轮入队 */
  @Put('active')
  async setActive(@Body(new ZodValidationPipe(activeSchema)) dto: z.infer<typeof activeSchema>) {
    if (dto.providerId !== null) {
      const row = await this.providers.getProvider(dto.providerId);
      if (!row) throw new NotFoundException('模型配置不存在');
      if (!row.enabled) throw new BadRequestException('该模型已停用，无法设为 active');
      if (row.provider === 'azure') {
        throw new BadRequestException('azure（机翻）仅用于翻译，不能设为分析 active 模型');
      }
      // 订阅模式（claude_cli）无 Key；其余 provider 须有可用 Key 才能设为 active
      if (
        row.provider !== 'claude_cli' &&
        (await this.providers.countUsableKeys(dto.providerId, nowSec())) === 0
      ) {
        throw new BadRequestException('该模型无可用 API Key，请先添加或复位后再设为启用');
      }
    }
    await this.settings.setActiveProviderId(dto.providerId);
    await this.analysisConfig.reloadAnalysisConfig();
    // 即时生效：选用后立刻入一轮队，无需等下一次定时调度（批次上限与定时调度同取运行期设置）
    const round = await this.analysisConfig.enqueueAutoAnalysisRound(
      await this.runtimeSettings.getAnalyzeBatchSize(),
    );
    logger.info(
      `[设置] active 模型 → ${dto.providerId ?? '（清空）'}；即时入队 ${round.enqueued} 篇`,
    );
    return { activeProviderId: dto.providerId, enqueued: round.enqueued };
  }

  /**
   * PUT /api/settings/translation-provider —— 选用翻译模型 { providerId: number|null }。
   * 与分析 active 解耦（可单独指更省额度的档）；清空则翻译回落 active provider。支持 claude_cli / azure。
   */
  @Put('translation-provider')
  async setTranslationProvider(
    @Body(new ZodValidationPipe(activeSchema)) dto: z.infer<typeof activeSchema>,
  ) {
    if (dto.providerId !== null) {
      const row = await this.providers.getProvider(dto.providerId);
      if (!row) throw new NotFoundException('模型配置不存在');
      if (!row.enabled) throw new BadRequestException('该模型已停用，无法用于翻译');
      if (row.provider !== 'claude_cli' && row.provider !== 'azure') {
        throw new BadRequestException('翻译暂仅支持 claude_cli（订阅）/ azure（机翻）');
      }
      if (
        row.provider === 'azure' &&
        (await this.providers.countUsableKeys(dto.providerId, nowSec())) === 0
      ) {
        throw new BadRequestException('该 Azure 翻译模型无可用 API Key，请先添加或复位');
      }
    }
    await this.settings.setTranslationProviderId(dto.providerId);
    logger.info(`[设置] 翻译 provider → ${dto.providerId ?? '（清空，回落 active）'}`);
    return { translationProviderId: dto.providerId };
  }
}
