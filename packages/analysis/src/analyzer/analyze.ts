import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import { analyzeWithAnthropic, callRawAnthropic, createAnthropicClient } from './anthropic';
import { analyzeWithClaudeAgent, callRawClaudeAgent } from './claude-agent';
import {
  analyzeWithOpenAICompatible,
  callRawOpenAICompatible,
  type OpenAICompatibleConfig,
} from './openai-compatible';

/**
 * 已解析的分析方式配置（按一条 model_providers 记录或 env 推导）。
 * - `anthropic`：调用 Anthropic（Claude 系列模型，API Key 按量计费）
 * - `claude_cli`：经 Claude Agent SDK 复用本机已登录的 claude（订阅计划额度，无 API Key）
 * - `openai` / `deepseek`：调用 OpenAI 兼容接口（openai 用 json_schema strict，deepseek 用 json_object）
 */
export type AnalysisConfig =
  | { provider: 'anthropic'; apiKey: string; model: string }
  | { provider: 'claude_cli'; model: string }
  | OpenAICompatibleConfig;

/**
 * 单次分析的 token 用量（用于精确成本核算）；某些 provider 不报告时整体为 null。
 * 区分缓存：缓存写入 / 命中计费倍率与普通输入不同（如 Anthropic 写 1.25× 读 0.1×）。
 */
export interface TokenUsage {
  /** 非缓存输入 token */
  inputTokens: number;
  outputTokens: number;
  /** 写入缓存的输入 token（无独立写入计费的 provider 为 0） */
  cacheWriteTokens: number;
  /** 命中缓存的输入 token */
  cacheReadTokens: number;
}

/** 处理器单次分析的产出：结构化洞察 + token 用量（usage 缺报时为 null） */
export interface AnalysisOutcome {
  insight: InsightResult;
  usage: TokenUsage | null;
}

/**
 * 「只调模型、不归一化」的原始产出（流水线检视器 ai_call 节点用，亦是 analyze 的内部第一步）。
 * 把不可重算的 AI 调用与廉价纯函数 normalizeInsight 拆开，使检视器能分别留痕、对比归一化前后。
 */
export interface RawModelOutput {
  /** 模型原始输出：anthropic/openai 为 JSON 文本；claude_cli 为 structured_output 对象 */
  raw: string | object;
  usage: TokenUsage | null;
  /**
   * API Key 模式实际使用的 Key id（多 Key 故障转移时由 callRawWithFailover 填入；
   * 底层单 provider 处理器与 claude_cli 不设，留空）。
   */
  keyId?: number | null;
  /** 是否发生过 Key 切换（故障转移到非首选 Key）。 */
  keySwitched?: boolean;
}

/**
 * 单篇帖子的处理器：屏蔽 Anthropic / OpenAI / DeepSeek 的差异，**只负责产出结构化结果**。
 *
 * 落库/标记/计失败由调用方（AnalysisService / WorkerService）完成——处理器保持无副作用、
 * 不依赖数据库，便于在任意进程构造与测试。
 */
export interface PostProcessor {
  /** 启动日志与批次日志展示用的处理器名称，如 `Anthropic (claude-opus-4-8)` */
  readonly label: string;
  /** 写入洞察记录的模型 ID 快照 */
  readonly model: string;
  /**
   * 分析单篇帖子，返回结构化结果（失败时抛出，由调用方计入失败并重试）。
   * @param signal 可选中止信号；job 超时时触发，使底层 AI 调用立即 abort，不空耗连接与额度
   */
  analyze(post: PostRow, comments: CommentRow[], signal?: AbortSignal): Promise<AnalysisOutcome>;
  /**
   * 分步：只调模型拿原始输出，不归一化（流水线检视器 ai_call 节点用）。
   * `analyze` 内部即 `callRaw` + `normalizeInsight`，二者共享同一条调用逻辑、杜绝行为分叉。
   * @param context buildContext 生成的上下文文本
   * @param signal 可选中止信号（同 analyze）
   */
  callRaw(context: string, signal?: AbortSignal): Promise<RawModelOutput>;
}

/**
 * 按已解析的分析配置创建对应的处理器。
 * @param cfg 分析方式配置（anthropic / openai / deepseek）
 * @returns 对应 provider 的 PostProcessor
 */
export function createProcessor(cfg: AnalysisConfig): PostProcessor {
  switch (cfg.provider) {
    case 'anthropic': {
      const client = createAnthropicClient(cfg.apiKey);
      return {
        label: `Anthropic (${cfg.model})`,
        model: cfg.model,
        analyze: (post, comments, signal) =>
          analyzeWithAnthropic(client, cfg.model, post, comments, signal),
        callRaw: (context, signal) => callRawAnthropic(client, cfg.model, context, signal),
      };
    }
    case 'claude_cli':
      return {
        label: `Claude CLI (${cfg.model})`,
        model: cfg.model,
        analyze: (post, comments, signal) =>
          analyzeWithClaudeAgent(cfg.model, post, comments, signal),
        callRaw: (context, signal) => callRawClaudeAgent(cfg.model, context, signal),
      };
    case 'openai':
    case 'deepseek': {
      const label = cfg.provider === 'openai' ? 'OpenAI' : 'DeepSeek';
      return {
        label: `${label} (${cfg.model})`,
        model: cfg.model,
        analyze: (post, comments, signal) =>
          analyzeWithOpenAICompatible(cfg, post, comments, signal),
        callRaw: (context, signal) => callRawOpenAICompatible(cfg, context, signal),
      };
    }
  }
}
