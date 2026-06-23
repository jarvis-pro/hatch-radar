import { query } from '@anthropic-ai/claude-agent-sdk';
import type { TokenUsage } from '../analyzer/analyze';
import {
  TRANSLATION_SYSTEM_PROMPT,
  buildTranslationPrompt,
  normalizeTranslationItems,
} from './prompt';
import { TRANSLATION_JSON_SCHEMA } from './translation-schema';
import type { TranslateItem, TranslatedItem } from './translate';

/** 单批翻译的最大对话轮数（结构化输出额外占一轮，留余量） */
const MAX_TURNS = 5;

/**
 * 把外部 AbortSignal 桥接成 query() 的 AbortController——job 超时即停掉在途 claude 子进程、
 * 不空耗订阅额度。（与 analyzer/claude-agent 同形；为一个小工具不反向耦合两处。）
 */
function linkAbort(signal: AbortSignal | undefined): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!signal) {
    return { controller, dispose: () => {} };
  }
  if (signal.aborted) {
    controller.abort();
    return { controller, dispose: () => {} };
  }
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  return { controller, dispose: () => signal.removeEventListener('abort', onAbort) };
}

/** query() 消息里本处理器关心的字段子集 */
interface ResultMessageView {
  type: string;
  subtype?: string;
  structured_output?: unknown;
  errors?: string[];
}

/**
 * 解读一条 query() 消息并决定去留：
 * - 非 result 消息 → null（继续读下一条）
 * - result + success + structured_output → 归一化为译文条目数组
 * - 其余 result（缺 structured_output / 各类 error subtype，含限流、max_turns）→ 抛错
 *
 * 抽成纯函数：分发逻辑可脱离 query() 子进程单测（`vi.mock` 拦不住该 SDK，会真起 claude）。
 * @param message query() 异步流里的一条消息
 */
export function translationFromMessage(message: ResultMessageView): TranslatedItem[] | null {
  if (message.type !== 'result') {
    return null;
  }
  if (message.subtype === 'success' && message.structured_output !== undefined) {
    return normalizeTranslationItems(message.structured_output);
  }
  const detail =
    message.subtype === 'success'
      ? '缺少 structured_output'
      : `${message.subtype ?? 'unknown'}${message.errors?.length ? `：${message.errors.join('; ')}` : ''}`;
  throw new Error(`Claude 订阅模式翻译结果非预期（${detail}）`);
}

/**
 * 用「Claude 订阅模式」翻译一批条目：经 @anthropic-ai/claude-agent-sdk 的 query() 复用 worker
 * 本机已登录的 claude，吃订阅额度、无需 API Key；outputFormat=json_schema 强制逐条结构化返回。
 * 与分析路径同源：allowedTools / settingSources 置空，隔离本机/项目设置、不触发权限询问。
 * @param model 模型 ID（如 claude-opus-4-8 / claude-sonnet-4-6）
 * @param items 本批待译条目（已在上游按体量分批）
 * @param signal 可选中止信号（job 超时即 abort 子进程）
 * @returns 译文条目 + token 用量（usage 缺报时为 null）
 */
export async function translateBatchWithClaudeAgent(
  model: string,
  items: TranslateItem[],
  signal?: AbortSignal,
): Promise<{ results: TranslatedItem[]; usage: TokenUsage | null }> {
  signal?.throwIfAborted();
  const { controller, dispose } = linkAbort(signal);
  try {
    for await (const message of query({
      prompt: buildTranslationPrompt(items),
      options: {
        model,
        systemPrompt: TRANSLATION_SYSTEM_PROMPT,
        outputFormat: { type: 'json_schema', schema: TRANSLATION_JSON_SCHEMA },
        allowedTools: [],
        maxTurns: MAX_TURNS,
        settingSources: [],
        abortController: controller,
      },
    })) {
      const results = translationFromMessage(message);
      if (results) {
        const u = (
          message as {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            };
          }
        ).usage;
        return {
          results,
          usage: u
            ? {
                inputTokens: u.input_tokens ?? 0,
                outputTokens: u.output_tokens ?? 0,
                cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
                cacheReadTokens: u.cache_read_input_tokens ?? 0,
              }
            : null,
        };
      }
    }
    throw new Error('Claude 订阅模式翻译 query 结束但未收到 result 消息');
  } finally {
    dispose();
  }
}
