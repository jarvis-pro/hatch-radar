import type { CommentRow, InsightResult, PostRow } from '@hatch-radar/shared';
import { analyzeWithAnthropic, createAnthropicClient } from './anthropic';
import { analyzeWithOpenAICompatible, type OpenAICompatibleConfig } from './openai-compatible';

/**
 * 已解析的分析方式配置（按一条 model_providers 记录或 env 推导）。
 * - `anthropic`：调用 Anthropic（Claude 系列模型）
 * - `openai` / `deepseek`：调用 OpenAI 兼容接口（openai 用 json_schema strict，deepseek 用 json_object）
 */
export type AnalysisConfig =
  | { provider: 'anthropic'; apiKey: string; model: string }
  | OpenAICompatibleConfig;

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
  /** 分析单篇帖子，返回结构化结果（失败时抛出，由调用方计入失败并重试） */
  analyze(post: PostRow, comments: CommentRow[]): Promise<InsightResult>;
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
        analyze: (post, comments) => analyzeWithAnthropic(client, cfg.model, post, comments),
      };
    }
    case 'openai':
    case 'deepseek': {
      const label = cfg.provider === 'openai' ? 'OpenAI' : 'DeepSeek';
      return {
        label: `${label} (${cfg.model})`,
        model: cfg.model,
        analyze: (post, comments) => analyzeWithOpenAICompatible(cfg, post, comments),
      };
    }
  }
}

/** runBatch() 的批次执行统计 */
export interface AnalysisStats {
  /** 本批次成功处理的帖子数（含无洞察产出的帖子） */
  analyzed: number;
  /** 产出并写入洞察记录的帖子数 */
  saved: number;
  /** 处理过程中抛出异常的帖子数 */
  failed: number;
}
