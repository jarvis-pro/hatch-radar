import type { AiCallOutput } from '@hatch-radar/shared';

/**
 * 环节产物读取 + token 用量提取的共享工具（worker 收尾与 analyze 执行器同源）。
 *
 * 抽出此处是因 {@link usageFromSteps}（WorkerService.finalizeTaskSuccess 用）与 analyze 节点函数
 * （AnalyzeExecutor 用）都要按环节名读上游已落库的检查点产物，二者共用同一组读取形状/工具。
 */

/** 环节产物读取的最小形状（TaskStageRow 满足；据此读上游检查点）。 */
export type StageLike = { name: string; output: unknown };

/** 取某环节已落库的产物并按目标形状读取（上游检查点；未跑/无产物为 undefined）。 */
export function stepOutput<T>(stages: readonly StageLike[], name: string): T | undefined {
  const out = stages.find((s) => s.name === name)?.output;
  return (out ?? undefined) as T | undefined;
}

/** token 用量形状（ai_call / translate 环节产物的 usage 字段同形）。 */
export type StageUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

/** 从 ai_call 或 translate 环节产物提取 token 用量，供整条任务计费（缺则 null）。 */
export function usageFromSteps(stages: readonly StageLike[]): StageUsage | null {
  const fromAi = stepOutput<AiCallOutput>(stages, 'ai_call')?.usage;
  if (fromAi) {
    return fromAi;
  }
  return stepOutput<{ usage: StageUsage | null }>(stages, 'translate')?.usage ?? null;
}
