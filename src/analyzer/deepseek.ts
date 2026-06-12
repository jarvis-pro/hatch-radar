import { buildContext } from '../crawler/context';
import type { CommentRow } from '../db/comments';
import type { PostRow } from '../db/posts';
import {
  JSON_OUTPUT_DIRECTIVE,
  SYSTEM_PROMPT,
  buildUserPrompt,
  normalizeInsight,
  type InsightResult,
} from './prompt';

/** DeepSeek（OpenAI 兼容接口）调用所需配置 */
export interface DeepSeekConfig {
  /** DeepSeek API 密钥 */
  apiKey: string;
  /** API 基地址，默认 https://api.deepseek.com */
  baseUrl: string;
  /** 模型 ID，推荐 deepseek-chat（支持 JSON 输出模式） */
  model: string;
}

/** chat/completions 响应中本项目关心的字段子集 */
interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

const MAX_RETRIES = 3;
const MAX_TOKENS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 向 DeepSeek chat/completions 发起请求，对 429 / 5xx 与网络错误做指数退避重试。
 * - 4xx（鉴权失败、请求非法等）直接抛出，不重试
 * @throws 重试耗尽或遇到不可重试错误时抛出
 */
async function postChat(
  cfg: DeepSeekConfig,
  body: Record<string, unknown>,
): Promise<ChatCompletion> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(2 ** attempt * 500);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastErr = err; // 网络层错误，重试
      continue;
    }
    if (res.ok) return (await res.json()) as ChatCompletion;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`DeepSeek 返回 ${res.status}`);
      continue;
    }
    const detail = await res.text().catch(() => '');
    throw new Error(`DeepSeek 请求失败 ${res.status}: ${detail.slice(0, 200)}`);
  }
  throw new Error(
    `DeepSeek 重试 ${MAX_RETRIES} 次仍失败: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/** 容错解析：去除可能的 Markdown 代码块包裹后再 JSON.parse */
function parseLooseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

/**
 * 对单篇帖子调用 DeepSeek 进行结构化分析，返回痛点与产品机会。
 * - 使用 JSON 输出模式（response_format: json_object），格式约束写入 system prompt
 * - 输出经 normalizeInsight 归一化兜底，容忍字段缺失或被代码块包裹
 * @param cfg DeepSeek 配置
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论
 * @returns 归一化后的分析结果；pain_points / opportunities 可能为空数组
 */
export async function analyzeWithDeepSeek(
  cfg: DeepSeekConfig,
  post: PostRow,
  comments: CommentRow[],
): Promise<InsightResult> {
  const data = await postChat(cfg, {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    stream: false,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${JSON_OUTPUT_DIRECTIVE}` },
      { role: 'user', content: buildUserPrompt(buildContext(post, comments)) },
    ],
  });
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek 未返回内容');
  }
  return normalizeInsight(parseLooseJson(content));
}
