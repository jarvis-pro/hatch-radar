import Anthropic from '@anthropic-ai/sdk';
import { buildContext } from '../crawler/context.js';
import type { CommentRow, PostRow } from '../db/queries.js';
import * as q from '../db/queries.js';
import { log } from '../log.js';
import {
  INSIGHT_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
  type InsightResult,
  type Intensity,
} from './prompt.js';

export function createAnthropicClient(apiKey: string): Anthropic {
  // SDK 自带对 429 / 5xx 的指数退避重试
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

export interface AnalysisStats {
  analyzed: number;
  saved: number;
  failed: number;
}

/** 取一批未分析帖子逐条送入 Claude，落库洞察结果 */
export async function runAnalysisBatch(
  client: Anthropic,
  model: string,
  batchSize: number,
): Promise<AnalysisStats> {
  const posts = q.getPostsToAnalyze(batchSize);
  const stats: AnalysisStats = { analyzed: 0, saved: 0, failed: 0 };
  if (posts.length === 0) return stats;

  log.info(`本轮待分析帖子 ${posts.length} 篇（模型: ${model}）`);
  for (const post of posts) {
    const comments = q.getCommentsForPost(post.id);
    try {
      const insight = await analyzePost(client, model, post, comments);
      const now = q.nowSec();
      if (insight.pain_points.length > 0 || insight.opportunities.length > 0) {
        q.saveInsight(post, model, insight, now);
        stats.saved++;
        log.info(
          `  ✓ r/${post.subreddit}「${post.title.slice(0, 48)}」→ 痛点 ${insight.pain_points.length} / 机会 ${insight.opportunities.length}`,
        );
      }
      q.markAnalyzed(post.id, now);
      stats.analyzed++;
    } catch (err) {
      stats.failed++;
      q.bumpAnalyzeAttempts(post.id);
      log.error(`  ✗ 分析失败 ${post.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}
