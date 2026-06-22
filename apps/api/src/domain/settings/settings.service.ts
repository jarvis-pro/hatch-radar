import { Injectable } from '@nestjs/common';
import { AnalysisConfigService } from '../analysis/analysis-config.service';
import {
  ProvidersRepository,
  SettingsRepository,
  toProviderDTO,
  type KeyInput,
  type KeyUpdate,
  type ProviderInput,
} from '@/database';
import { RuntimeSettingsService, type RuntimeSettingsPatch } from './runtime-settings.service';
import { isSecretConfigured } from '@/utils/crypto';
import { NotFoundError, ValidationError } from '@/domain/errors';
import { nowSec } from '@/utils/time';
import { logger } from '@/logger';
import { PipelineService } from '../pipeline/pipeline.service';

type ProviderKind = 'anthropic' | 'openai' | 'deepseek' | 'claude_cli' | 'azure';

/** 新建模型入参（对应控制器 createSchema）。 */
export type ProviderCreateInput = {
  provider: ProviderKind;
  label: string;
  apiKey?: string;
  baseUrl?: string;
  region?: string;
  model: string;
  enabled?: boolean;
  inputPrice?: number | null;
  outputPrice?: number | null;
};

/** 更新模型入参（对应控制器 updateSchema）。 */
export type ProviderUpdateInput = {
  provider?: ProviderKind;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
  region?: string;
  model?: string;
  enabled?: boolean;
  inputPrice?: number | null;
  outputPrice?: number | null;
};

/** '' / 仅空白的 baseUrl 归一化为 undefined（不存空串）。 */
function normalizeBaseUrl(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * 模型清单 CRUD + Key 池管理 + active / 翻译 provider 选用 + 运行期可调项的领域服务。
 *
 * 从 SettingsController 抽出的多仓储 / 多服务编排与业务规则：密钥加密前置校验、claude_cli 订阅模式与
 * azure 机翻的字段差异、**改 baseUrl 必须重填 API Key 的安全闸**、写后热重载。业务失败一律抛 DomainError，
 * 由全局异常过滤器按 status 映射成 HTTP——领域服务不依赖 HTTP 层。
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly pipeline: PipelineService,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  // ── 运行期可调项 ───────────────────────────────────────────────────────────────

  /** 五项运行期可调项有效态（当前值 / env 默认 / 是否覆盖）。 */
  getRuntimeOverview() {
    return this.runtimeSettings.getOverview();
  }

  /** 写入运行期参数（整数），保存即生效（实时读库，无需重启或版本广播）。 */
  applyRuntimeSettings(patch: RuntimeSettingsPatch) {
    return this.runtimeSettings.applySettings(patch);
  }

  // ── 模型清单 ─────────────────────────────────────────────────────────────────

  /** providers（含 Key 池脱敏）+ activeProviderId + translationProviderId + secretConfigured。 */
  async getOverview() {
    return {
      providers: (await this.providers.listProvidersWithKeys()).map(toProviderDTO),
      activeProviderId: await this.settings.getActiveProviderId(),
      translationProviderId: await this.settings.getTranslationProviderId(),
      secretConfigured: isSecretConfigured(),
    };
  }

  /** 模型清单（含 Key 池脱敏）。 */
  async listProviders() {
    return (await this.providers.listProvidersWithKeys()).map(toProviderDTO);
  }

  /** 新建模型（含第一把 Key，密钥加密入库）。 */
  async createProvider(dto: ProviderCreateInput): Promise<{ id: number }> {
    const isCli = dto.provider === 'claude_cli';
    if (!isCli) {
      if (!dto.apiKey) throw new ValidationError('该模型必须提供 API Key');
      if (!isSecretConfigured()) {
        throw new ValidationError('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
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
   * 更新模型标量字段（密钥走 Key 池端点）。
   * 安全闸：改 baseUrl 必须同时重填 API Key——否则旧密钥会被发往新地址。重填时整个 Key 池被替换成这一把新 Key。
   */
  async updateProvider(id: number, dto: ProviderUpdateInput): Promise<void> {
    if (dto.apiKey && !isSecretConfigured()) {
      throw new ValidationError('未配置 SETTINGS_SECRET，无法加密新密钥');
    }
    const existing = await this.providers.getProvider(id);
    if (!existing) throw new NotFoundError('模型配置不存在');

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
      return;
    }

    // azure（机翻）：单把 Key、不走多 Key 池——提供 apiKey 即整体替换那把 Key，否则仅改标量字段
    if ((dto.provider ?? existing.provider) === 'azure') {
      const { apiKey: azureKey, ...azureScalar } = dto;
      const fields: Partial<ProviderInput> = { ...azureScalar };
      if (azureKey) {
        if (!isSecretConfigured()) {
          throw new ValidationError('未配置 SETTINGS_SECRET，无法加密新密钥');
        }
        await this.providers.updateProviderAndResetKeys(id, fields, azureKey, nowSec());
      } else if (Object.keys(fields).length > 0) {
        await this.providers.updateProvider(id, fields, nowSec());
      }
      await this.analysisConfig.reloadAnalysisConfig();
      logger.info(`[设置] 更新 Azure 翻译模型 #${id}${azureKey ? '（已更换 Key）' : ''}`);
      return;
    }

    const { apiKey, ...scalarDto } = dto;
    const fields: Partial<ProviderInput> = { ...scalarDto };
    if (dto.baseUrl !== undefined) fields.baseUrl = normalizeBaseUrl(dto.baseUrl);

    const nextBaseUrl =
      dto.baseUrl !== undefined ? (fields.baseUrl ?? null) : (existing.base_url ?? null);
    const baseUrlChanged = (existing.base_url ?? null) !== nextBaseUrl;

    if (baseUrlChanged) {
      if (!apiKey) {
        throw new ValidationError(
          '修改 baseUrl 时必须同时重新填写 API Key（旧 Key 将被清空，避免被发往新地址）',
        );
      }
      await this.providers.updateProviderAndResetKeys(id, fields, apiKey, nowSec());
    } else if (Object.keys(fields).length > 0) {
      await this.providers.updateProvider(id, fields, nowSec());
    }
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 更新模型 #${id}${baseUrlChanged ? '（baseUrl 变更，Key 池已重置）' : ''}`);
  }

  /** 删除模型（Key 池级联删除；若为 active 则清空 active）。 */
  async deleteProvider(id: number): Promise<void> {
    const removed = await this.providers.deleteProvider(id);
    if (!removed) throw new NotFoundError('模型配置不存在');
    if ((await this.settings.getActiveProviderId()) === id) {
      await this.settings.setActiveProviderId(null);
    }
    await this.analysisConfig.reloadAnalysisConfig();
    logger.info(`[设置] 删除模型 #${id}`);
  }

  /** 用最优可用 Key 探测连通性，始终返回 { ok, error? }。 */
  testProvider(id: number) {
    return this.analysisConfig.testProvider(id);
  }

  // ── API Key 池 ────────────────────────────────────────────────────────────────

  /** 新增一把备用 Key（密钥加密入库）。 */
  async addKey(providerId: number, input: KeyInput): Promise<{ id: number }> {
    if (!isSecretConfigured()) {
      throw new ValidationError('未配置 SETTINGS_SECRET，无法加密入库，请先在 .env 设置');
    }
    const provider = await this.providers.getProvider(providerId);
    if (!provider) throw new NotFoundError('模型配置不存在');
    if (provider.provider === 'claude_cli') {
      throw new ValidationError('订阅模式（Claude CLI）复用本机登录态，无需也不支持 API Key');
    }
    if (provider.provider === 'azure') {
      throw new ValidationError('Azure 翻译仅用单把 Key，请用「编辑模型」更换，不走多 Key 池');
    }
    const id = await this.providers.createKey(providerId, input, nowSec());
    logger.info(`[设置] 模型 #${providerId} 新增 Key #${id}`);
    return { id };
  }

  /** 改备注/优先级/启停；reset 复位 invalid/cooling。 */
  async updateKey(providerId: number, keyId: number, patch: KeyUpdate): Promise<void> {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) {
      throw new NotFoundError('API Key 不存在');
    }
    if (Object.keys(patch).length > 0) await this.providers.updateKey(keyId, patch, nowSec());
  }

  /** 删除一把 Key。 */
  async deleteKey(providerId: number, keyId: number): Promise<void> {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) {
      throw new NotFoundError('API Key 不存在');
    }
    await this.providers.deleteKey(keyId);
    logger.info(`[设置] 模型 #${providerId} 删除 Key #${keyId}`);
  }

  /** 测试指定 Key，返回 { ok, error? }。 */
  async testKey(providerId: number, keyId: number): Promise<{ ok: boolean; error?: string }> {
    const key = await this.providers.getKey(keyId);
    if (!key || key.provider_id !== providerId) {
      throw new NotFoundError('API Key 不存在');
    }
    return this.analysisConfig.testProviderKey(keyId);
  }

  // ── 选用 active / 翻译 provider ─────────────────────────────────────────────────

  /** 选用分析 active 模型；即时热重载并触发一轮入队。 */
  async setActive(
    providerId: number | null,
  ): Promise<{ activeProviderId: number | null; enqueued: number }> {
    if (providerId !== null) {
      const row = await this.providers.getProvider(providerId);
      if (!row) throw new NotFoundError('模型配置不存在');
      if (!row.enabled) throw new ValidationError('该模型已停用，无法设为 active');
      if (row.provider === 'azure') {
        throw new ValidationError('azure（机翻）仅用于翻译，不能设为分析 active 模型');
      }
      // 订阅模式（claude_cli）无 Key；其余 provider 须有可用 Key 才能设为 active
      if (
        row.provider !== 'claude_cli' &&
        (await this.providers.countUsableKeys(providerId, nowSec())) === 0
      ) {
        throw new ValidationError('该模型无可用 API Key，请先添加或复位后再设为启用');
      }
    }
    await this.settings.setActiveProviderId(providerId);
    await this.analysisConfig.reloadAnalysisConfig();
    // 即时生效：选用后立刻派生一轮 analyze 任务（归属 run/blueprint），无需等下一次定时调度。
    const round = await this.pipeline.runAnalyzeSweep('manual');
    logger.info(`[设置] active 模型 → ${providerId ?? '（清空）'}；即时入队 ${round.created} 篇`);
    return { activeProviderId: providerId, enqueued: round.created };
  }

  /** 选用翻译模型（与分析 active 解耦）；清空则翻译回落 active provider。支持 claude_cli / azure。 */
  async setTranslationProvider(
    providerId: number | null,
  ): Promise<{ translationProviderId: number | null }> {
    if (providerId !== null) {
      const row = await this.providers.getProvider(providerId);
      if (!row) throw new NotFoundError('模型配置不存在');
      if (!row.enabled) throw new ValidationError('该模型已停用，无法用于翻译');
      if (row.provider !== 'claude_cli' && row.provider !== 'azure') {
        throw new ValidationError('翻译暂仅支持 claude_cli（订阅）/ azure（机翻）');
      }
      if (
        row.provider === 'azure' &&
        (await this.providers.countUsableKeys(providerId, nowSec())) === 0
      ) {
        throw new ValidationError('该 Azure 翻译模型无可用 API Key，请先添加或复位');
      }
    }
    await this.settings.setTranslationProviderId(providerId);
    logger.info(`[设置] 翻译 provider → ${providerId ?? '（清空，回落 active）'}`);
    return { translationProviderId: providerId };
  }
}
