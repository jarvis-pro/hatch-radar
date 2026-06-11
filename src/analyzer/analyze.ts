import Anthropic from '@anthropic-ai/sdk';
import { buildContext } from '../crawler/context';
import { getCommentsForPost } from '../db/comments';
import { bumpAnalyzeAttempts, getPostsToAnalyze, markAnalyzed } from '../db/posts';
import type { CommentRow } from '../db/comments';
import type { PostRow } from '../db/posts';
import { saveInsight } from '../db/insights';
import { nowSec } from '../db/utils';
import { logger } from '../logger';
import {
  INSIGHT_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
  type InsightResult,
  type Intensity,
} from './prompt';

/**
 * 创建 Anthropic SDK 客户端实例。
 * - 内置 429 / 5xx 指数退避重试，最多 3 次
 * @param apiKey Anthropic API 密钥
 * @returns 配置好重试策略的客户端实例
 */
export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 3 });
}

function normalizeIntensity(value: unknown): Intensity {
  const upper = String(value).toUpperCase();
  return upper === 'HIGH' || upper === 'LOW' ? upper : 'MEDIUM';
}

/** 结构化输出已由 schema 约束，这里再做一层兜底归一化 */
function normalizeInsight(raw: unknown): InsightResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const painPoints = Array.isArray(data.pain_points) ? data.pain_points : [];
  const opportunities = Array.isArray(data.opportunities) ? data.opportunities : [];
  const tags = Array.isArray(data.tags) ? data.tags : [];
  return {
    pain_points: painPoints
      .map((p: Record<string, unknown>) => ({
        description: String(p?.description ?? '').trim(),
        evidence: String(p?.evidence ?? '').trim(),
        intensity: normalizeIntensity(p?.intensity),
      }))
      .filter((p) => p.description.length > 0),
    opportunities: opportunities
      .map((o: Record<string, unknown>) => ({
        title: String(o?.title ?? '').trim(),
        description: String(o?.description ?? '').trim(),
        target_user: String(o?.target_user ?? '').trim(),
      }))
      .filter((o) => o.title.length > 0),
    tags: tags.map((t) => String(t).trim()).filter((t) => t.length > 0),
  };
}

/**
 * 对单篇帖子调用 Claude 进行结构化分析，返回痛点与产品机会。
 * - 使用 adaptive thinking 与 JSON schema 约束输出格式
 * - 网络错误由 SDK 内置重试处理；业务异常直接上抛
 * @param client Anthropic SDK 实例
 * @param model 使用的模型 ID
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论
 * @returns 归一化后的分析结果；pain_points / opportunities 可能为空数组
 */
export async function analyzePost(
  client: Anthropic,
  model: string,
  post: PostRow,
  comments: CommentRow[],
): Promise<InsightResult> {
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(buildContext(post, comments)) }],
    output_config: {
      format: { type: 'json_schema', schema: INSIGHT_SCHEMA as unknown as Record<string, unknown> },
    },
  });
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  if (!textBlock) {
    throw new Error(`模型未返回文本内容 (stop_reason=${response.stop_reason})`);
  }
  return normalizeInsight(JSON.parse(textBlock.text));
}

/** runAnalysisBatch() 的批次执行统计 */
export interface AnalysisStats {
  /** 本批次成功完成分析的帖子数（含无洞察产出的帖子） */
  analyzed: number;
  /** 产出并写入洞察记录的帖子数 */
  saved: number;
  /** 分析过程中抛出异常的帖子数 */
  failed: number;
}

/**
 * 取一批待分析帖子逐条送入 Claude，将有效洞察落库。
 * - 分析失败时递增 analyze_attempts，不影响后续帖子的处理
 * - pain_points 与 opportunities 均为空时不写入洞察（视为无信号），但仍标记为已分析
 * @param client Anthropic SDK 实例
 * @param model 使用的模型 ID
 * @param batchSize 本批次最多分析的帖子数
 * @returns 本批次的执行统计
 */
export async function runAnalysisBatch(
  client: Anthropic,
  model: string,
  batchSize: number,
): Promise<AnalysisStats> {
  const posts = getPostsToAnalyze(batchSize);
  const stats: AnalysisStats = { analyzed: 0, saved: 0, failed: 0 };
  if (posts.length === 0) return stats;

  logger.info(`本轮待分析帖子 ${posts.length} 篇（模型: ${model}）`);
  for (const post of posts) {
    const comments = getCommentsForPost(post.id);
    try {
      const insight = await analyzePost(client, model, post, comments);
      const now = nowSec();
      if (insight.pain_points.length > 0 || insight.opportunities.length > 0) {
        saveInsight(post, model, insight, now);
        stats.saved++;
        logger.info(
          `  ✓ r/${post.subreddit}「${post.title.slice(0, 48)}」→ 痛点 ${insight.pain_points.length} / 机会 ${insight.opportunities.length}`,
        );
      }
      markAnalyzed(post.id, now);
      stats.analyzed++;
    } catch (err) {
      stats.failed++;
      bumpAnalyzeAttempts(post.id);
      logger.error(`  ✗ 分析失败 ${post.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}
