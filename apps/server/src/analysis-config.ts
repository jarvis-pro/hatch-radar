import { createProcessor, type AnalysisConfig, type PostProcessor } from './analyzer/analyze';
import { testAnthropic } from './analyzer/anthropic';
import { testOpenAICompatible } from './analyzer/openai-compatible';
import { decryptSecret, isSecretConfigured } from './crypto';
import { enqueueJobs } from './db/jobs';
import { getPostsToAnalyze } from './db/posts';
import { createProvider, getProvider, listProviders, type ProviderRow } from './db/providers';
import { getActiveProviderId, setActiveProviderId } from './db/settings';
import { nowSec } from './db/utils';
import { logger } from './logger';

/**
 * analyzer 的运行时配置层：把 model_providers 行解析成处理器，承载「选用 active 模型」
 * 的状态机与「保存即生效」的热重载。worker 通过 {@link getProcessorForProvider} 按 job
 * 解析处理器；定时调度与设置端点通过 {@link enqueueAutoAnalysisRound} 入队。
 */

/** 默认每轮自动入队上限（设置端点即时触发时用；定时调度按 env.analyzeBatchSize 传入） */
const DEFAULT_BATCH_SIZE = 20;

/** 按 provider id 缓存已构建的处理器；reloadAnalysisConfig 时清空 */
const processorCache = new Map<number, PostProcessor>();

/** 把一条模型配置行（解密密钥后）转成 AnalysisConfig */
function providerToConfig(row: ProviderRow): AnalysisConfig {
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
export function getProcessorForProvider(providerId: number): PostProcessor | null {
  const cached = processorCache.get(providerId);
  if (cached) return cached;
  const row = getProvider(providerId);
  if (!row || row.enabled !== 1) return null;
  try {
    const processor = createProcessor(providerToConfig(row));
    processorCache.set(providerId, processor);
    return processor;
  } catch (err) {
    logger.error(
      `构建模型处理器失败（provider#${providerId}）: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** 当前选用的 active 模型（供调度与启动日志使用） */
export interface ActiveProvider {
  id: number;
  model: string;
  /** 展示名，如 `openai (gpt-4o)` */
  label: string;
}

/**
 * 取当前选用的 active 模型。
 * @returns active 模型；未选用或对应配置已停用/删除时返回 null（→ 不自动分析）
 */
export function getActiveProvider(): ActiveProvider | null {
  const id = getActiveProviderId();
  if (id == null) return null;
  const row = getProvider(id);
  if (!row || row.enabled !== 1) return null;
  return { id: row.id, model: row.model, label: `${row.provider} (${row.model})` };
}

/**
 * 热重载分析配置：清空处理器缓存，使密钥/模型/启用项的变更对下一条任务即时生效。
 * 在任意设置写操作后调用（无需重启进程）。
 */
export function reloadAnalysisConfig(): void {
  processorCache.clear();
  logger.info('[analysis] 配置已热重载（处理器缓存已清空）');
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

/**
 * 按 active 模型把一批待分析帖子入队（auto）。
 * - 未配置 active 模型时不入队，直接返回 active=null（自动分析关闭的状态）
 * @param batchSize 本轮上限，默认 {@link DEFAULT_BATCH_SIZE}
 */
export function enqueueAutoAnalysisRound(batchSize: number = DEFAULT_BATCH_SIZE): AutoRoundResult {
  const active = getActiveProvider();
  if (!active) return { active: null, enqueued: 0, pending: 0 };
  const posts = getPostsToAnalyze(batchSize);
  const enqueued = enqueueJobs(
    posts.map((p) => p.id),
    active.id,
    active.model,
    'auto',
    nowSec(),
  );
  return { active, enqueued, pending: posts.length };
}

/**
 * 启动时一次性迁移：库中尚无任何模型配置、且 env 指定了模型 provider 时，
 * 把 env 里的密钥加密入库并设为 active，保持既有行为不中断。
 * - 库中已有配置则跳过（DB 为权威来源）
 * - env 未指定模型（analysis 为 null）或未配 SETTINGS_SECRET 则跳过
 * @param analysis env 解析出的分析配置，可为 null
 */
export function seedProvidersFromEnvIfEmpty(analysis: AnalysisConfig | null): void {
  if (!analysis) return;
  if (listProviders().length > 0) return;
  if (!isSecretConfigured()) {
    logger.warn('检测到 env 模型配置，但未设 SETTINGS_SECRET，跳过迁移入库（请在设置页重新配置）');
    return;
  }
  const id = createProvider(
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
  setActiveProviderId(id);
  logger.info(`已将 env 模型配置迁移入库并设为 active：${analysis.provider} (${analysis.model})`);
}

/** enqueueManualRun 结果 */
export interface ManualRunResult {
  ok: boolean;
  enqueued: number;
  error?: string;
}

/**
 * 手动运行：把管理员选中的帖子按指定模型入队（trigger=manual）。
 * - 与定时入队共用幂等去重；可对已分析帖子重跑（saveInsight upsert 覆盖）
 * @param postIds 选中的帖子 ID
 * @param providerId 指定使用的模型配置 ID
 */
export function enqueueManualRun(postIds: string[], providerId: number): ManualRunResult {
  const row = getProvider(providerId);
  if (!row) return { ok: false, enqueued: 0, error: '模型配置不存在' };
  if (row.enabled !== 1) return { ok: false, enqueued: 0, error: '该模型已停用' };
  const enqueued = enqueueJobs(postIds, providerId, row.model, 'manual', nowSec());
  return { ok: true, enqueued };
}

/**
 * 连通性测试：用某条模型配置发一次极小请求验证可用性。
 * @param providerId 模型配置 ID
 * @returns ok 与可选错误信息（不抛出）
 */
export async function testProvider(providerId: number): Promise<{ ok: boolean; error?: string }> {
  const row = getProvider(providerId);
  if (!row) return { ok: false, error: '模型配置不存在' };
  let config: AnalysisConfig;
  try {
    config = providerToConfig(row);
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
