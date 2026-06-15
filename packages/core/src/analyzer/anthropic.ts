import Anthropic from '@anthropic-ai/sdk';
import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import { buildContext } from './context';
import { INSIGHT_JSON_SCHEMA } from './insight-schema';
import { SYSTEM_PROMPT, buildUserPrompt, normalizeInsight } from './prompt';

/** 单次请求超时（毫秒）：避免某次调用挂死后拖住整个分析队列 */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * 创建 Anthropic SDK 客户端实例。
 * - 内置 429 / 5xx 指数退避重试，最多 3 次
 * - 单次请求超时 {@link REQUEST_TIMEOUT_MS}，超时即中止（不让慢调用永久挂起）
 * @param apiKey Anthropic API 密钥
 * @returns 配置好重试与超时策略的客户端实例
 */
export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 3, timeout: REQUEST_TIMEOUT_MS });
}

/**
 * 对单篇帖子调用 Anthropic 进行结构化分析，返回痛点与产品机会。
 * - 使用 adaptive thinking 与 JSON schema 约束输出格式
 * - 网络错误由 SDK 内置重试处理；业务异常直接上抛
 * @param client Anthropic SDK 实例
 * @param model 使用的模型 ID
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论
 * @param signal 可选中止信号（job 超时时 abort，立即中断在途请求）
 * @returns 归一化后的分析结果；pain_points / opportunities 可能为空数组
 */
export async function analyzeWithAnthropic(
  client: Anthropic,
  model: string,
  post: PostRow,
  comments: CommentRow[],
  signal?: AbortSignal,
): Promise<InsightResult> {
  const response = await client.messages.create(
    {
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(buildContext(post, comments)) }],
      output_config: {
        format: { type: 'json_schema', schema: INSIGHT_JSON_SCHEMA },
      },
    },
    { signal },
  );
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  if (!textBlock) {
    throw new Error(`模型未返回文本内容 (stop_reason=${response.stop_reason})`);
  }
  return normalizeInsight(JSON.parse(textBlock.text));
}

/**
 * 连通性测试：发一次极小请求验证密钥/模型可用。
 * - 不重试、短超时，便于设置页快速反馈；失败（如 401）直接抛出
 * @param apiKey Anthropic API 密钥
 * @param model 模型 ID
 */
export async function testAnthropic(apiKey: string, model: string): Promise<void> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });
  await client.messages.create({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
}
