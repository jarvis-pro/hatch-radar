import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import { createProcessor, type AnalysisConfig, type PostProcessor } from '../analyzer/analyze';
import { testAnthropic } from '../analyzer/anthropic';
import { testOpenAICompatible } from '../analyzer/openai-compatible';
import { decryptSecret } from '../utils/crypto';
import type { Dispatcher } from '../gateway/protocol';
import { JobsRepository } from '../db/jobs.repository';
import { PostsRepository } from '../db/posts.repository';
import {
  ProvidersRepository,
  type ProviderApiKeyRow,
  type ProviderRow,
} from '../db/providers.repository';
import { SettingsRepository } from '../db/settings.repository';
import { nowSec } from '../utils/time';
import { logger } from '../logger';

/** enqueueAutoAnalysisRound 的兜底批次（调用方一般传运行期设置 analyzeBatchSize；省略时用此值） */
const DEFAULT_BATCH_SIZE = 20;

/**
 * 一把 Key 触发限流后的冷却窗（秒）：此窗内不再选用，到点 selectKey 自动当可用。
 * 注：当前为固定窗；指数退避（按连续冷却次数递增、上限封顶）留作后续细化。
 */
const COOLDOWN_SECONDS = 300;

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

/** 一把 Key 失败的归类：limit=限流可冷却重试 / auth=鉴权失败或额度耗尽需人工 / other=非 Key 问题 */
type KeyErrorKind = 'rate_limit' | 'auth' | 'other';

/** 取错误信息文本 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 归类一次模型调用失败是否「该把 Key 的问题」。
 * - Anthropic SDK 抛 APIError 带 `status`；openai 兼容路径抛 Error 且消息含状态码（见 openai-compatible.ts）
 * - 仅在明确的限流(429)/鉴权(401/403)/额度信号下降级该 Key；其余（网络/超时/5xx）归 other，冒泡重试，不冤枉 Key
 */
function classifyKeyError(err: unknown): KeyErrorKind {
  const status = (err as { status?: number })?.status;
  const m = errMsg(err);
  if (status === 429 || /\b429\b|rate.?limit|too many requests/i.test(m)) return 'rate_limit';
  if (
    status === 401 ||
    status === 403 ||
    /\b401\b|\b403\b|unauthor|invalid.*api.?key|insufficient_quota|exceeded.*quota|额度/i.test(m)
  ) {
    return 'auth';
  }
  return 'other';
}

/** 用一条模型配置 + 一把明文 Key 组装 AnalysisConfig */
function providerConfigWithKey(provider: ProviderRow, apiKey: string): AnalysisConfig {
  switch (provider.provider) {
    case 'anthropic':
      return { provider: 'anthropic', apiKey, model: provider.model };
    case 'openai':
      return {
        provider: 'openai',
        apiKey,
        baseUrl: provider.base_url ?? 'https://api.openai.com/v1',
        model: provider.model,
      };
    case 'deepseek':
      return {
        provider: 'deepseek',
        apiKey,
        baseUrl: provider.base_url ?? 'https://api.deepseek.com',
        model: provider.model,
      };
  }
}

/**
 * analyzer 的运行时配置层（框架无关）：把 model_providers 行解析成处理器，承载「选用 active 模型」
 * 的状态机与「保存即生效」的热重载。worker 通过 {@link getProcessorForProvider} 按 job 解析处理器；
 * 定时调度与设置端点通过 {@link enqueueAutoAnalysisRound} 入队。
 *
 * 多 Key 故障转移：处理器不绑定具体 Key——每次 analyze 时按 priority 实时挑「可用」Key，逐把尝试。
 *
 * 派发器（gateway）为可选注入：api 侧入队后触发 push 派发；worker 侧不入队，留空即可（`this.gateway?.`）。
 */
export class AnalysisConfigService {
  /** 按 provider id 缓存已构建的处理器；本进程 reloadAnalysisConfig 或检测到跨进程版本变更时清空 */
  private readonly processorCache = new Map<number, PostProcessor>();
  /** 本进程缓存所反映的分析配置版本号；落后于库中版本即失效重建（跨进程感知设置变更） */
  private cacheVersion = -1;

  constructor(
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
    private readonly jobs: JobsRepository,
    private readonly posts: PostsRepository,
    private readonly gateway?: Dispatcher,
  ) {}

  /**
   * 取某条模型配置对应的处理器（带缓存）。处理器内部做多 Key 故障转移。
   * @param providerId model_providers.id
   */
  async getProcessorForProvider(providerId: number): Promise<PostProcessor | null> {
    await this.syncCacheVersion();
    const cached = this.processorCache.get(providerId);
    if (cached) return cached;
    const provider = await this.providers.getProvider(providerId);
    if (!provider || !provider.enabled) return null;
    const processor: PostProcessor = {
      label: `${provider.provider} (${provider.model})`,
      model: provider.model,
      analyze: (post, comments, signal) =>
        this.analyzeWithFailover(provider, post, comments, signal),
    };
    this.processorCache.set(providerId, processor);
    return processor;
  }

  /**
   * 多 Key 故障转移：按 priority 取可用 Key 逐把尝试，单次任务执行内切换。
   * @throws 无任何可用 Key、或所有可用 Key 均失败时抛出
   */
  private async analyzeWithFailover(
    provider: ProviderRow,
    post: PostRow,
    comments: CommentRow[],
    signal?: AbortSignal,
  ): Promise<InsightResult> {
    const keys = await this.providers.listUsableKeys(provider.id, nowSec());
    if (keys.length === 0) {
      throw new Error(
        `模型「${provider.label}」无可用 API Key（全部停用/限流/失效），请在设置页补充或复位`,
      );
    }
    let lastErr: unknown;
    for (const key of keys) {
      signal?.throwIfAborted(); // job 超时后不再尝试下一把
      let plain: string;
      try {
        plain = decryptSecret(key.api_key);
      } catch (err) {
        await this.providers.markKeyInvalid(key.id, `密钥解密失败：${errMsg(err)}`, nowSec());
        lastErr = err;
        continue;
      }
      const underlying = createProcessor(providerConfigWithKey(provider, plain));
      try {
        const result = await underlying.analyze(post, comments, signal);
        if (key.status !== 'active') {
          await this.providers.updateKey(key.id, { reset: true }, nowSec()); // 冷却后恢复，自愈为 active
        }
        return result;
      } catch (err) {
        if (signal?.aborted) throw err; // job 超时：不再切换，直接冒泡
        const kind = classifyKeyError(err);
        const m = errMsg(err);
        if (kind === 'rate_limit') {
          await this.providers.markKeyCooling(key.id, nowSec() + COOLDOWN_SECONDS, m, nowSec());
          logger.warn(
            `[analysis] Key#${key.id}（${provider.label}）限流，冷却 ${COOLDOWN_SECONDS}s，切下一把`,
          );
          lastErr = err;
          continue;
        }
        if (kind === 'auth') {
          await this.providers.markKeyInvalid(key.id, m, nowSec());
          logger.warn(
            `[analysis] Key#${key.id}（${provider.label}）鉴权失败/额度耗尽，标记失效，切下一把`,
          );
          lastErr = err;
          continue;
        }
        throw err; // 非 Key 问题：冒泡给 worker（provider 已内部退避）
      }
    }
    throw new Error(`模型「${provider.label}」所有可用 API Key 均失败：${errMsg(lastErr)}`);
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
   * 热重载分析配置：递增库中 config 版本并清空本进程处理器缓存，使模型标量变更对下一条任务即时生效。
   */
  async reloadAnalysisConfig(): Promise<void> {
    const version = await this.settings.bumpConfigVersion();
    this.processorCache.clear();
    this.cacheVersion = version;
    logger.info('[analysis] 配置已热重载（config 版本 +1，跨进程 worker 下个任务即生效）');
  }

  /** 跨进程缓存失效：比对库中 config 版本，落后即清空本进程处理器缓存。 */
  private async syncCacheVersion(): Promise<void> {
    const version = await this.settings.getConfigVersion();
    if (version !== this.cacheVersion) {
      this.processorCache.clear();
      this.cacheVersion = version;
    }
  }

  /**
   * 按 active 模型把一批待分析帖子入队（auto）。
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
   * 手动运行：把管理员选中的帖子按指定模型入队（trigger=manual）。
   * @param postIds 选中的帖子 ID
   * @param providerId 指定使用的模型配置 ID
   */
  async enqueueManualRun(postIds: string[], providerId: number): Promise<ManualRunResult> {
    const row = await this.providers.getProvider(providerId);
    if (!row) return { ok: false, enqueued: 0, error: '模型配置不存在' };
    if (!row.enabled) return { ok: false, enqueued: 0, error: '该模型已停用' };
    const enqueued = await this.jobs.enqueueJobs(postIds, providerId, row.model, 'manual', nowSec());
    if (enqueued > 0) void this.gateway?.tryDispatch();
    return { ok: true, enqueued };
  }

  /**
   * 连通性测试：用某模型当前「最优可用」的一把 Key 发一次极小请求。
   * @returns ok 与可选错误信息（不抛出）
   */
  async testProvider(providerId: number): Promise<{ ok: boolean; error?: string }> {
    const provider = await this.providers.getProvider(providerId);
    if (!provider) return { ok: false, error: '模型配置不存在' };
    const keys = await this.providers.listUsableKeys(providerId, nowSec());
    if (keys.length === 0) return { ok: false, error: '无可用 API Key（请先添加或复位）' };
    return this.runKeyTest(provider, keys[0]);
  }

  /**
   * 连通性测试：测试某模型下指定的一把 Key（含 invalid 态，便于人工复测后复位）。
   * @returns ok 与可选错误信息（不抛出）
   */
  async testProviderKey(keyId: number): Promise<{ ok: boolean; error?: string }> {
    const key = await this.providers.getKey(keyId);
    if (!key) return { ok: false, error: 'API Key 不存在' };
    const provider = await this.providers.getProvider(key.provider_id);
    if (!provider) return { ok: false, error: '模型配置不存在' };
    return this.runKeyTest(provider, key);
  }

  /** 用一把 Key 跑一次连通性测试（解密 → 按 provider 类型探测），不抛出 */
  private async runKeyTest(
    provider: ProviderRow,
    key: ProviderApiKeyRow,
  ): Promise<{ ok: boolean; error?: string }> {
    let plain: string;
    try {
      plain = decryptSecret(key.api_key);
    } catch (err) {
      return { ok: false, error: `密钥解密失败：${errMsg(err)}` };
    }
    const cfg = providerConfigWithKey(provider, plain);
    try {
      if (cfg.provider === 'anthropic') await testAnthropic(cfg.apiKey, cfg.model);
      else await testOpenAICompatible(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  }
}
