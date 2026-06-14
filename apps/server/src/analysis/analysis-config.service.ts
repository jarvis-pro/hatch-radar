import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { createProcessor, type AnalysisConfig, type PostProcessor } from '@/analyzer/analyze';
import { testAnthropic } from '@/analyzer/anthropic';
import { testOpenAICompatible } from '@/analyzer/openai-compatible';
import { APP_ENV } from '@/common/tokens';
import { decryptSecret, isSecretConfigured } from '@/utils/crypto';
import type { AppEnv } from '@/config/env';
import { GatewayService } from '@/gateway/gateway.service';
import { JobsRepository } from '@/db/jobs.repository';
import { PostsRepository } from '@/db/posts.repository';
import { ProvidersRepository, type ProviderRow } from '@/db/providers.repository';
import { SettingsRepository } from '@/db/settings.repository';
import { nowSec } from '@/utils/time';
import { logger } from '@/logger';

/** 默认每轮自动入队上限（设置端点即时触发时用；定时调度按 env.analyzeBatchSize 传入） */
const DEFAULT_BATCH_SIZE = 20;

/** 当前选用的 active 模型（供调度与启动日志使用） */
export interface ActiveProvider {
  id: number;
  model: string;
  /** 展示名，如 `openai (gpt-4o)` */
  label: string;
}

/** enqueueAutoAnalysisRound 的结果 */
export interface AutoRoundResult {
  /** 本轮使用的 active 模型；为 null 表示未配置、未入队 */
  active: ActiveProvider | null;
  /** 实际新入队的任务数 */
  enqueued: number;
  /** 待分析帖子总数（含已在队列中的） */
  pending: number;
}

/** enqueueManualRun 结果 */
export interface ManualRunResult {
  ok: boolean;
  enqueued: number;
  error?: string;
}

/**
 * analyzer 的运行时配置层：把 model_providers 行解析成处理器，承载「选用 active 模型」
 * 的状态机与「保存即生效」的热重载。worker 通过 {@link getProcessorForProvider} 按 job
 * 解析处理器；定时调度与设置端点通过 {@link enqueueAutoAnalysisRound} 入队。
 */
@Injectable()
export class AnalysisConfigService implements OnModuleInit {
  /** 按 provider id 缓存已构建的处理器；本进程 reloadAnalysisConfig 或检测到跨进程版本变更时清空 */
  private readonly processorCache = new Map<number, PostProcessor>();
  /** 本进程缓存所反映的分析配置版本号；落后于库中版本即失效重建（跨进程感知设置变更） */
  private cacheVersion = -1;

  constructor(
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
    private readonly jobs: JobsRepository,
    private readonly posts: PostsRepository,
    @Inject(APP_ENV) private readonly env: AppEnv,
    // GatewayModule 为 @Global()，仅在主进程可用；standalone worker 进程中为 undefined
    @Optional() private readonly gateway?: GatewayService,
  ) {}

  /**
   * 启动时一次性迁移 env 模型配置入库（在任何 onApplicationBootstrap 之前完成，
   * 保证调度首轮入队前 active 模型已就绪）。
   */
  async onModuleInit(): Promise<void> {
    await this.seedProvidersFromEnvIfEmpty(this.env.analysis);
  }

  /** 把一条模型配置行（解密密钥后）转成 AnalysisConfig */
  private providerToConfig(row: ProviderRow): AnalysisConfig {
    const apiKey = decryptSecret(row.api_key);
    switch (row.provider) {
      case 'anthropic':
        return { provider: 'anthropic', apiKey, model: row.model };
      case 'openai':
        return {
          provider: 'openai',
          apiKey,
          baseUrl: row.base_url ?? 'https://api.openai.com/v1',
          model: row.model,
        };
      case 'deepseek':
        return {
          provider: 'deepseek',
          apiKey,
          baseUrl: row.base_url ?? 'https://api.deepseek.com',
          model: row.model,
        };
    }
  }

  /**
   * 取某条模型配置对应的处理器（带缓存）。
   * - 配置不存在 / 已停用 / 密钥解密失败 时返回 null（由调用方判失败，不崩进程）
   * @param providerId model_providers.id
   */
  async getProcessorForProvider(providerId: number): Promise<PostProcessor | null> {
    await this.syncCacheVersion();
    const cached = this.processorCache.get(providerId);
    if (cached) return cached;
    const row = await this.providers.getProvider(providerId);
    if (!row || !row.enabled) return null;
    try {
      const processor = createProcessor(this.providerToConfig(row));
      this.processorCache.set(providerId, processor);
      return processor;
    } catch (err) {
      logger.error(
        `构建模型处理器失败（provider#${providerId}）: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * 取当前选用的 active 模型。
   * @returns active 模型；未选用或对应配置已停用/删除时返回 null（→ 不自动分析）
   */
  async getActiveProvider(): Promise<ActiveProvider | null> {
    const id = await this.settings.getActiveProviderId();
    if (id == null) return null;
    const row = await this.providers.getProvider(id);
    if (!row || !row.enabled) return null;
    return { id: row.id, model: row.model, label: `${row.provider} (${row.model})` };
  }

  /**
   * 热重载分析配置：递增库中 config 版本并清空本进程处理器缓存，使密钥/模型/启用项的变更
   * 对下一条任务即时生效。在任意设置写操作后调用（无需重启进程）。
   * 递增版本号是为了让独立 worker 进程（持各自缓存实例）也能在下个任务感知变更。
   */
  async reloadAnalysisConfig(): Promise<void> {
    const version = await this.settings.bumpConfigVersion();
    this.processorCache.clear();
    this.cacheVersion = version;
    logger.info('[analysis] 配置已热重载（config 版本 +1，跨进程 worker 下个任务即生效）');
  }

  /**
   * 跨进程缓存失效：比对库中 config 版本，落后即清空本进程处理器缓存。
   * 独立 worker 进程与 HTTP 进程各持一份缓存——靠共享版本号感知对方的设置写操作。
   */
  private async syncCacheVersion(): Promise<void> {
    const version = await this.settings.getConfigVersion();
    if (version !== this.cacheVersion) {
      this.processorCache.clear();
      this.cacheVersion = version;
    }
  }

  /**
   * 按 active 模型把一批待分析帖子入队（auto）。
   * - 未配置 active 模型时不入队，直接返回 active=null（自动分析关闭的状态）
   * @param batchSize 本轮上限，默认 {@link DEFAULT_BATCH_SIZE}
   */
  async enqueueAutoAnalysisRound(batchSize: number = DEFAULT_BATCH_SIZE): Promise<AutoRoundResult> {
    const active = await this.getActiveProvider();
    if (!active) return { active: null, enqueued: 0, pending: 0 };
    const posts = await this.posts.getPostsToAnalyze(batchSize);
    const enqueued = await this.jobs.enqueueJobs(
      posts.map((p) => p.id),
      active.id,
      active.model,
      'auto',
      nowSec(),
    );
    if (enqueued > 0) void this.gateway?.tryDispatch();
    return { active, enqueued, pending: posts.length };
  }

  /**
   * 启动时一次性迁移：库中尚无任何模型配置、且 env 指定了模型 provider 时，
   * 把 env 里的密钥加密入库并设为 active，保持既有行为不中断。
   * @param analysis env 解析出的分析配置，可为 null
   */
  async seedProvidersFromEnvIfEmpty(analysis: AnalysisConfig | null): Promise<void> {
    if (!analysis) return;
    if ((await this.providers.listProviders()).length > 0) return;
    if (!isSecretConfigured()) {
      logger.warn(
        '检测到 env 模型配置，但未设 SETTINGS_SECRET，跳过迁移入库（请在设置页重新配置）',
      );
      return;
    }
    const id = await this.providers.createProvider(
      {
        provider: analysis.provider,
        label: `${analysis.provider}（env 迁移）`,
        apiKey: analysis.apiKey,
        baseUrl: 'baseUrl' in analysis ? analysis.baseUrl : null,
        model: analysis.model,
        enabled: true,
      },
      nowSec(),
    );
    await this.settings.setActiveProviderId(id);
    logger.info(`已将 env 模型配置迁移入库并设为 active：${analysis.provider} (${analysis.model})`);
  }

  /**
   * 手动运行：把管理员选中的帖子按指定模型入队（trigger=manual）。
   * - 与定时入队共用幂等去重；可对已分析帖子重跑（saveInsight upsert 覆盖）
   * @param postIds 选中的帖子 ID
   * @param providerId 指定使用的模型配置 ID
   */
  async enqueueManualRun(postIds: string[], providerId: number): Promise<ManualRunResult> {
    const row = await this.providers.getProvider(providerId);
    if (!row) return { ok: false, enqueued: 0, error: '模型配置不存在' };
    if (!row.enabled) return { ok: false, enqueued: 0, error: '该模型已停用' };
    const enqueued = await this.jobs.enqueueJobs(
      postIds,
      providerId,
      row.model,
      'manual',
      nowSec(),
    );
    if (enqueued > 0) void this.gateway?.tryDispatch();
    return { ok: true, enqueued };
  }

  /**
   * 连通性测试：用某条模型配置发一次极小请求验证可用性。
   * @param providerId 模型配置 ID
   * @returns ok 与可选错误信息（不抛出）
   */
  async testProvider(providerId: number): Promise<{ ok: boolean; error?: string }> {
    const row = await this.providers.getProvider(providerId);
    if (!row) return { ok: false, error: '模型配置不存在' };
    let config: AnalysisConfig;
    try {
      config = this.providerToConfig(row);
    } catch (err) {
      return {
        ok: false,
        error: `密钥解密失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
    try {
      if (config.provider === 'anthropic') await testAnthropic(config.apiKey, config.model);
      else if (config.provider === 'openai' || config.provider === 'deepseek')
        await testOpenAICompatible(config);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
