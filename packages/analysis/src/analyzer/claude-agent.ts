import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import type { AnalysisOutcome } from './analyze';
import { buildContext } from './context';
import { INSIGHT_JSON_SCHEMA } from './insight-schema';
import { SYSTEM_PROMPT, buildUserPrompt, normalizeInsight } from './prompt';

/**
 * 「Claude 订阅模式」单次分析的最大对话轮数。
 * 结构化输出会额外占一轮（模型回答 + SDK 抽取 structured_output），留余量避免被截断。
 */
const MAX_TURNS = 5;

/**
 * 把外部 AbortSignal 桥接成 query() 需要的 AbortController：
 * 外部 signal（job 超时）一触发即 abort 这次 query，及时停掉底层 claude 子进程、不空耗订阅额度。
 * @returns controller 传给 query()；dispose 解除监听，避免 signal 泄漏回调
 */
function linkAbort(signal: AbortSignal | undefined): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!signal) return { controller, dispose: () => {} };
  if (signal.aborted) {
    controller.abort();
    return { controller, dispose: () => {} };
  }
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  return { controller, dispose: () => signal.removeEventListener('abort', onAbort) };
}

/** query() 消息里本处理器关心的字段子集（用于判定 result 并取值，不绑定 SDK 的大联合类型） */
interface ResultMessageView {
  type: string;
  subtype?: string;
  structured_output?: unknown;
  errors?: string[];
}

/**
 * 解读一条 query() 消息并决定去留：
 * - 非 result 消息 → 返回 null（调用方继续读下一条）
 * - result + success + structured_output → 归一化为 {@link InsightResult}
 * - 其余 result（success 但缺 structured_output，或各类 error subtype——含限流 / max_turns）→ 抛错
 *
 * 抽成纯函数：分发逻辑可脱离 query() 子进程单测（见 apps/api/test/claude-agent.spec.ts）。
 * @param message query() 异步流里的一条消息
 * @returns 命中成功结果时返回归一化洞察；非 result 返回 null；异常 result 抛错
 */
export function insightFromMessage(message: ResultMessageView): InsightResult | null {
  if (message.type !== 'result') return null;
  if (message.subtype === 'success' && message.structured_output !== undefined) {
    return normalizeInsight(message.structured_output);
  }
  const detail =
    message.subtype === 'success'
      ? '缺少 structured_output'
      : `${message.subtype ?? 'unknown'}${message.errors?.length ? `：${message.errors.join('; ')}` : ''}`;
  throw new Error(`Claude 订阅模式结果非预期（${detail}）`);
}

/**
 * 对单篇帖子用「Claude 订阅模式」做结构化分析：经 @anthropic-ai/claude-agent-sdk 的 query()
 * 复用 worker 本机已登录的 claude（Claude Code），吃订阅计划额度、无需 API Key。
 * - 指令走 systemPrompt、数据走 prompt；outputFormat=json_schema 强制结构化（结果落在 structured_output）
 * - allowedTools / settingSources 置空：纯文本抽取不需任何工具，且隔离本机 / 项目设置（不读 CLAUDE.md），
 *   保证确定性与最低开销、不触发权限询问
 * - 复用与 Anthropic / OpenAI 路径同源的 schema / prompt / normalize，产出与其它 provider 一致
 * - 业务异常直接上抛，由 worker 计入失败并按队列策略重试（无 Key 池故障转移）
 * @param model 使用的模型 ID（如 claude-opus-4-8）
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论
 * @param signal 可选中止信号（job 超时时 abort，停掉在途 query 子进程）
 * @returns 归一化后的分析结果；pain_points / opportunities 可能为空数组
 */
export async function analyzeWithClaudeAgent(
  model: string,
  post: PostRow,
  comments: CommentRow[],
  signal?: AbortSignal,
): Promise<AnalysisOutcome> {
  signal?.throwIfAborted();
  const { controller, dispose } = linkAbort(signal);
  try {
    for await (const message of query({
      prompt: buildUserPrompt(buildContext(post, comments)),
      options: {
        model,
        systemPrompt: SYSTEM_PROMPT,
        outputFormat: { type: 'json_schema', schema: INSIGHT_JSON_SCHEMA },
        allowedTools: [],
        maxTurns: MAX_TURNS,
        settingSources: [],
        abortController: controller,
      },
    })) {
      const insight = insightFromMessage(message);
      if (insight) {
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
          insight,
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
    throw new Error('Claude 订阅模式 query 结束但未收到 result 消息');
  } finally {
    dispose();
  }
}

/**
 * 连通性测试：发一次极小 query() 验证 worker 本机的 claude 可用（已安装且已登录）。
 * 不带结构化输出、关掉工具、隔离设置、单轮即止；失败直接抛出，便于设置页快速反馈。
 * @param model 模型 ID
 */
export async function testClaudeAgent(model: string): Promise<void> {
  for await (const message of query({
    prompt: 'ping',
    options: {
      model,
      systemPrompt: '只回复 pong，不要调用任何工具。',
      allowedTools: [],
      maxTurns: 1,
      settingSources: [],
    },
  })) {
    if (message.type !== 'result') continue;
    if (message.subtype === 'success') return;
    throw new Error(
      `Claude CLI 不可用（${message.subtype}${message.errors.length ? `：${message.errors.join('; ')}` : ''}）`,
    );
  }
  throw new Error('Claude CLI 未返回结果（请确认 worker 本机已安装并登录 claude）');
}
