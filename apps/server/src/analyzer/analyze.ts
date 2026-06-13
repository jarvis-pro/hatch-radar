import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import { getCommentsForPost } from '../db/comments';
import { bumpAnalyzeAttempts, getPostsToAnalyze, markAnalyzed } from '../db/posts';
import { saveInsight } from '../db/insights';
import { nowSec } from '../db/utils';
import { logger } from '../logger';
import { analyzeWithAnthropic, createAnthropicClient } from './anthropic';
import { analyzeWithOpenAICompatible, type OpenAICompatibleConfig } from './openai-compatible';
import { writeManualAnalysisDoc } from './export';

/**
 * 已解析的分析方式配置，由 env 根据 AI_PROVIDER 推导（缺对应 key 会在校验阶段报错）。
 * - `anthropic`：调用 Anthropic（Claude 系列模型）
 * - `openai` / `deepseek`：调用 OpenAI 兼容接口（openai 用 json_schema strict，deepseek 用 json_object）
 * - `file`（默认）：将待分析内容导出为本地文件，供手动喂给 AI
 */
export type AnalysisConfig =
  | { provider: 'anthropic'; apiKey: string; model: string }
  | OpenAICompatibleConfig
  | { provider: 'file'; dir: string };

/**
 * 单篇帖子的处理器：屏蔽 Anthropic / DeepSeek / 本地导出三种方式的差异，
 * 由 runAnalysisBatch 统一调度。
 */
export interface PostProcessor {
  /** 启动日志与批次日志展示用的处理器名称，如 `Anthropic (claude-opus-4-8)` */
  readonly label: string;
  /**
   * 处理单篇帖子（分析并落库，或导出为文件）。失败时抛出，由批处理循环计入失败并重试。
   * @returns saved 是否产出并落库了洞察；本地导出模式恒为 false
   */
  process(post: PostRow, comments: CommentRow[]): Promise<{ saved: boolean }>;
}

/** 单篇帖子 → 结构化分析结果的函数签名，Anthropic 与 DeepSeek 各自实现 */
type AnalyzeFn = (post: PostRow, comments: CommentRow[]) => Promise<InsightResult>;

/**
 * 构造「调用模型分析并落库」的处理器（Anthropic / DeepSeek 共用）。
 * - pain_points 与 opportunities 均为空时视为无信号，不落库，saved 为 false
 * @param label 处理器展示名
 * @param model 写入洞察记录的模型 ID
 * @param analyze 实际的单篇分析函数
 */
function createModelProcessor(label: string, model: string, analyze: AnalyzeFn): PostProcessor {
  return {
    label,
    async process(post, comments) {
      const insight = await analyze(post, comments);
      if (insight.pain_points.length === 0 && insight.opportunities.length === 0) {
        return { saved: false };
      }
      saveInsight(post, model, insight, nowSec());
      logger.info(
        `  ✓ r/${post.subreddit}「${post.title.slice(0, 48)}」→ 痛点 ${insight.pain_points.length} / 机会 ${insight.opportunities.length}`,
      );
      return { saved: true };
    },
  };
}

/**
 * 构造「本地文件导出」处理器（AI_PROVIDER=file，默认方式）。
 * - 将待分析内容写入 `{dir}/{post.id}.md`，供用户手动喂给 AI
 * - 不产出洞察，saved 恒为 false；导出后由批处理循环标记为已分析以推进队列
 * @param dir 导出目录
 */
function createFileExportProcessor(dir: string): PostProcessor {
  return {
    label: `本地文件导出 (${dir})`,
    async process(post, comments) {
      const file = writeManualAnalysisDoc(dir, post, comments);
      logger.info(`  ✓ 已导出 r/${post.subreddit}「${post.title.slice(0, 48)}」→ ${file}`);
      return { saved: false };
    },
  };
}

/**
 * 按已解析的分析配置创建对应的处理器。
 * @param cfg env 推导出的分析方式配置
 * @returns 对应 provider 的 PostProcessor
 */
export function createProcessor(cfg: AnalysisConfig): PostProcessor {
  switch (cfg.provider) {
    case 'anthropic': {
      const client = createAnthropicClient(cfg.apiKey);
      return createModelProcessor(`Anthropic (${cfg.model})`, cfg.model, (post, comments) =>
        analyzeWithAnthropic(client, cfg.model, post, comments),
      );
    }
    case 'openai':
    case 'deepseek': {
      const label = cfg.provider === 'openai' ? 'OpenAI' : 'DeepSeek';
      return createModelProcessor(`${label} (${cfg.model})`, cfg.model, (post, comments) =>
        analyzeWithOpenAICompatible(cfg, post, comments),
      );
    }
    case 'file':
      return createFileExportProcessor(cfg.dir);
  }
}

/** runAnalysisBatch() 的批次执行统计 */
export interface AnalysisStats {
  /** 本批次成功处理的帖子数（含无洞察产出 / 仅导出的帖子） */
  analyzed: number;
  /** 产出并写入洞察记录的帖子数（本地导出模式恒为 0） */
  saved: number;
  /** 处理过程中抛出异常的帖子数 */
  failed: number;
}

/**
 * 取一批待分析帖子逐条交给处理器，处理失败不影响后续帖子。
 * - 失败时递增 analyze_attempts（达 3 次后不再重试），成功后标记为已分析
 * - 具体「分析并落库」还是「导出文件」由传入的 processor 决定
 * @param processor 单篇处理器（Anthropic / DeepSeek / 本地导出）
 * @param batchSize 本批次最多处理的帖子数
 * @returns 本批次的执行统计
 */
export async function runAnalysisBatch(
  processor: PostProcessor,
  batchSize: number,
): Promise<AnalysisStats> {
  const posts = getPostsToAnalyze(batchSize);
  const stats: AnalysisStats = { analyzed: 0, saved: 0, failed: 0 };
  if (posts.length === 0) return stats;

  logger.info(`本轮待处理帖子 ${posts.length} 篇（${processor.label}）`);
  for (const post of posts) {
    const comments = getCommentsForPost(post.id);
    try {
      const { saved } = await processor.process(post, comments);
      if (saved) stats.saved++;
      markAnalyzed(post.id, nowSec());
      stats.analyzed++;
    } catch (err) {
      stats.failed++;
      bumpAnalyzeAttempts(post.id);
      logger.error(`  ✗ 处理失败 ${post.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}
