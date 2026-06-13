import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import { buildContext } from '../crawler/context';
import { INSIGHT_JSON_SCHEMA } from './insight-schema';
import { JSON_OUTPUT_DIRECTIVE, SYSTEM_PROMPT, buildUserPrompt, normalizeInsight } from './prompt';

/**
 * OpenAI 兼容接口（chat/completions）调用配置，OpenAI 与 DeepSeek 共用一条代码路径。
 * - `openai`：用原生 `response_format: json_schema`（strict），由服务端强约束输出结构
 * - `deepseek`：仅支持 `response_format: json_object`，结构约束写进 system prompt
 */
export interface OpenAICompatibleConfig {
  /** 区分能力档位：openai 用 json_schema strict，deepseek 用 json_object + prompt 约束 */
  provider: 'openai' | 'deepseek';
  /** API 密钥 */
  apiKey: string;
  /** API 基地址（含版本段），如 https://api.openai.com/v1 或 https://api.deepseek.com */
  baseUrl: string;
  /** 模型 ID，如 gpt-4o / deepseek-chat */
  model: string;
}

/** chat/completions 响应中本项目关心的字段子集 */
interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

const MAX_RETRIES = 3;
const MAX_TOKENS = 8000;
/** 单次请求超时（毫秒）：超时即 abort，避免某次调用挂死后拖住整个分析队列 */
const REQUEST_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 向 chat/completions 发起请求，对 429 / 5xx、网络错误与超时中止做指数退避重试。
 * - 4xx（鉴权失败、请求非法等）直接抛出，不重试
 * - 每次请求带 {@link REQUEST_TIMEOUT_MS} 超时，超时归类为可重试错误
 * @throws 重试耗尽或遇到不可重试错误时抛出
 */
async function postChat(
  cfg: OpenAICompatibleConfig,
  body: Record<string, unknown>,
): Promise<ChatCompletion> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(2 ** attempt * 500);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      lastErr = err; // 网络层错误或超时中止，重试
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return (await res.json()) as ChatCompletion;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`${cfg.provider} 返回 ${res.status}`);
      continue;
    }
    const detail = await res.text().catch(() => '');
    throw new Error(`${cfg.provider} 请求失败 ${res.status}: ${detail.slice(0, 200)}`);
  }
  throw new Error(
    `${cfg.provider} 重试 ${MAX_RETRIES} 次仍失败: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
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
 * 对单篇帖子调用 OpenAI 兼容接口进行结构化分析，返回痛点与产品机会。
 * - OpenAI：`response_format: json_schema`（strict），用 {@link INSIGHT_JSON_SCHEMA} 强约束
 * - DeepSeek：`response_format: json_object`，把结构约束写进 system prompt
 * - 输出统一经 {@link normalizeInsight} 归一化兜底，容忍字段缺失或被代码块包裹
 * @param cfg OpenAI 兼容接口配置
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论
 * @returns 归一化后的分析结果；pain_points / opportunities 可能为空数组
 */
export async function analyzeWithOpenAICompatible(
  cfg: OpenAICompatibleConfig,
  post: PostRow,
  comments: CommentRow[],
): Promise<InsightResult> {
  const useJsonSchema = cfg.provider === 'openai';
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    stream: false,
    messages: [
      {
        role: 'system',
        content: useJsonSchema ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\n${JSON_OUTPUT_DIRECTIVE}`,
      },
      { role: 'user', content: buildUserPrompt(buildContext(post, comments)) },
    ],
    response_format: useJsonSchema
      ? {
          type: 'json_schema',
          json_schema: { name: 'insight', strict: true, schema: INSIGHT_JSON_SCHEMA },
        }
      : { type: 'json_object' },
  };
  const data = await postChat(cfg, body);
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${cfg.provider} 未返回内容`);
  }
  return normalizeInsight(parseLooseJson(content));
}

/**
 * 连通性测试：发一次极小请求验证密钥/模型/网关可用。
 * - 单次请求、不重试、15s 超时，便于设置页快速反馈；非 2xx 抛出含状态码的错误
 * @param cfg OpenAI 兼容接口配置
 */
export async function testOpenAICompatible(cfg: OpenAICompatibleConfig): Promise<void> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${res.status}: ${detail.slice(0, 160)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
