import Anthropic from '@anthropic-ai/sdk';
import { buildContext } from '../crawler/context';
import type { CommentRow } from '../db/comments';
import type { PostRow } from '../db/posts';
import {
  INSIGHT_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
  normalizeInsight,
  type InsightResult,
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

/**
 * 对单篇帖子调用 Anthropic 进行结构化分析，返回痛点与产品机会。
 * - 使用 adaptive thinking 与 JSON schema 约束输出格式
 * - 网络错误由 SDK 内置重试处理；业务异常直接上抛
 * @param client Anthropic SDK 实例
 * @param model 使用的模型 ID
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论
 * @returns 归一化后的分析结果；pain_points / opportunities 可能为空数组
 */
export async function analyzeWithAnthropic(
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
