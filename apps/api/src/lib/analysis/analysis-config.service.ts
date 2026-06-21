import type { CommentRow, PostRow } from '@hatch-radar/shared';
import type { ResolveOutput } from '@hatch-radar/shared';
import {
  createProcessor,
  type AnalysisConfig,
  type AnalysisOutcome,
  type PostProcessor,
  type RawModelOutput,
} from './analyzer/analyze';
import { testAnthropic } from './analyzer/anthropic';
import { testClaudeAgent } from './analyzer/claude-agent';
import { testOpenAICompatible } from './analyzer/openai-compatible';
import { testAzureTranslator } from './translator/azure-client';
import { classifyKeyError, errMsg, COOLDOWN_SECONDS } from './key-failover';
import { decryptSecret } from '@hatch-radar/kernel';
import { PostsRepository } from '@hatch-radar/db';
import { ProvidersRepository, type ProviderApiKeyRow, type ProviderRow } from '@hatch-radar/db';
import { SettingsRepository } from '@hatch-radar/db';
import { nowSec } from '@hatch-radar/kernel';
import { logger } from '@hatch-radar/kernel';

/** 当前选用的 active 模型（供调度与启动日志使用） */
export interface ActiveProvider {
  id: number;
  model: string;
  /** 展示名，如 `openai (gpt-4o)` */
  label: string;
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
    case 'claude_cli':
      // 订阅模式无 Key，不经此路径（getProcessorForProvider / testProvider 已提前分流）
      throw new Error('claude_cli（订阅模式）不使用 API Key 路径');
    case 'azure':
      // azure（机翻）仅用于翻译：不作为分析模型；runKeyTest 已提前分流，到此即用错路径
      throw new Error('azure（机翻）仅用于翻译，不参与分析 / 不走此 API Key 路径');
  }
}

/**
 * analyzer 的运行时配置层（框架无关）：把 model_providers 行解析成处理器，承载「选用 active 模型」
 * 的状态机与「保存即生效」的热重载。worker 通过 {@link getProcessorForProvider} 按 task 解析处理器。
 * 入队 / 编排（自动 / 手动 / 检视）已迁至 api 侧 PipelineService。
 *
 * 多 Key 故障转移：处理器不绑定具体 Key——每次 analyze 时按 priority 实时挑「可用」Key，逐把尝试。
 */
export class AnalysisConfigService {
  /** 按 provider id 缓存已构建的处理器；本进程 reloadAnalysisConfig 或检测到跨进程版本变更时清空 */
  private readonly processorCache = new Map<number, PostProcessor>();
  /** 本进程缓存所反映的分析配置版本号；落后于库中版本即失效重建（跨进程感知设置变更） */
  private cacheVersion = -1;

  constructor(
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
    private readonly posts: PostsRepository,
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
    // claude_cli 订阅模式无 Key：直接用引擎处理器（query() 复用本机登录态），不走多 Key 故障转移
    const processor: PostProcessor =
      provider.provider === 'claude_cli'
        ? createProcessor({ provider: 'claude_cli', model: provider.model })
        : {
            label: `${provider.provider} (${provider.model})`,
            model: provider.model,
            analyze: (post, comments, signal) =>
              this.analyzeWithFailover(provider, post, comments, signal),
            callRaw: (context, signal) => this.callRawWithFailover(provider, context, signal),
          };
    this.processorCache.set(providerId, processor);
    return processor;
  }

  /**
   * 多 Key 故障转移核心：按 priority 取可用 Key 逐把尝试，单次执行内切换；与具体动作（analyze /
   * callRaw）解耦——动作经 {@link run} 注入，故 normal 分析与检视器 ai_call 走**完全一致**的 Key 池逻辑。
   * 成功时自愈非 active 的 Key（reset）；限流→cooling、鉴权失败→invalid 后切下一把。
   * @param run 用某把 Key 构造的底层处理器去执行（u.analyze 或 u.callRaw）
   * @returns 动作结果 + 实际用的 Key id + 是否发生过切换
   * @throws 无任何可用 Key、或所有可用 Key 均失败时抛出
   */
  private async withKeyFailover<T>(
    provider: ProviderRow,
    signal: AbortSignal | undefined,
    run: (underlying: PostProcessor) => Promise<T>,
  ): Promise<{ result: T; keyId: number; switched: boolean }> {
    const keys = await this.providers.listUsableKeys(provider.id, nowSec());
    if (keys.length === 0) {
      throw new Error(
        `模型「${provider.label}」无可用 API Key（全部停用/限流/失效），请在设置页补充或复位`,
      );
    }
    let lastErr: unknown;
    let switched = false; // 一旦越过某把 Key（解密失败 / 限流 / 鉴权失败）即记为发生过切换
    for (const key of keys) {
      signal?.throwIfAborted(); // job 超时后不再尝试下一把
      let plain: string;
      try {
        plain = decryptSecret(key.api_key);
      } catch (err) {
        await this.providers.markKeyInvalid(key.id, `密钥解密失败：${errMsg(err)}`, nowSec());
        lastErr = err;
        switched = true;
        continue;
      }
      const underlying = createProcessor(providerConfigWithKey(provider, plain));
      try {
        const result = await run(underlying);
        if (key.status !== 'active') {
          await this.providers.updateKey(key.id, { reset: true }, nowSec()); // 冷却后恢复，自愈为 active
        }
        return { result, keyId: key.id, switched };
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
          switched = true;
          continue;
        }
        if (kind === 'auth') {
          await this.providers.markKeyInvalid(key.id, m, nowSec());
          logger.warn(
            `[analysis] Key#${key.id}（${provider.label}）鉴权失败/额度耗尽，标记失效，切下一把`,
          );
          lastErr = err;
          switched = true;
          continue;
        }
        throw err; // 非 Key 问题：冒泡给 worker（provider 已内部退避）
      }
    }
    throw new Error(`模型「${provider.label}」所有可用 API Key 均失败：${errMsg(lastErr)}`);
  }

  /** 多 Key 故障转移下做完整分析（normal 路径）。 */
  private async analyzeWithFailover(
    provider: ProviderRow,
    post: PostRow,
    comments: CommentRow[],
    signal?: AbortSignal,
  ): Promise<AnalysisOutcome> {
    const { result } = await this.withKeyFailover(provider, signal, (u) =>
      u.analyze(post, comments, signal),
    );
    return result;
  }

  /**
   * 多 Key 故障转移下只调模型拿原始输出（检视器 ai_call 节点用）：与生产同一 Key 池逻辑，
   * 并把「实际用了哪把 Key / 是否切换过」附到产物里供检视展示。
   */
  private async callRawWithFailover(
    provider: ProviderRow,
    context: string,
    signal?: AbortSignal,
  ): Promise<RawModelOutput> {
    const { result, keyId, switched } = await this.withKeyFailover(provider, signal, (u) =>
      u.callRaw(context, signal),
    );
    return { ...result, keyId, keySwitched: switched };
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

  // ─── 检视器 resolve 节点信息（worker execNode 复用；入队/编排已迁至 PipelineService）──────

  /**
   * 解析某条模型配置的展示信息（流水线检视器 resolve 节点产物 + 入队前校验）。
   * @returns provider 标签 / 模型 / 类型 / 可用 Key 数；配置不存在或已停用时 null
   */
  async getProviderInspectInfo(providerId: number): Promise<ResolveOutput | null> {
    const provider = await this.providers.getProvider(providerId);
    if (!provider || !provider.enabled) return null;
    // claude_cli 订阅模式无 Key 池；API Key 模式实时数可用 Key（active/冷却已过）
    const usableKeyCount =
      provider.provider === 'claude_cli'
        ? 0
        : (await this.providers.listUsableKeys(providerId, nowSec())).length;
    return {
      providerId: provider.id,
      label: provider.label,
      model: provider.model,
      providerKind: provider.provider,
      usableKeyCount,
    };
  }

  /**
   * 连通性测试：API Key 模式用当前「最优可用」的一把 Key 发一次极小请求；claude_cli 订阅模式
   * 直接探测 worker 本机的 claude（无 Key）。
   * @returns ok 与可选错误信息（不抛出）
   */
  async testProvider(providerId: number): Promise<{ ok: boolean; error?: string }> {
    const provider = await this.providers.getProvider(providerId);
    if (!provider) return { ok: false, error: '模型配置不存在' };
    if (provider.provider === 'claude_cli') {
      try {
        await testClaudeAgent(provider.model);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errMsg(err) };
      }
    }
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
    // azure（机翻）：不走 AnalysisConfig，直接探测 Translator（校验 key + region）
    if (provider.provider === 'azure') {
      try {
        await testAzureTranslator(plain, provider.region, provider.base_url);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errMsg(err) };
      }
    }
    const cfg = providerConfigWithKey(provider, plain);
    try {
      if (cfg.provider === 'anthropic') await testAnthropic(cfg.apiKey, cfg.model);
      else if (cfg.provider === 'claude_cli') await testClaudeAgent(cfg.model);
      else await testOpenAICompatible(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  }
}
