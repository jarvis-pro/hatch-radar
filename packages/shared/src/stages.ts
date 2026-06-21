/**
 * 任务环节模板（Stage Templates）—— api / worker / web 三端单一事实源。
 *
 * 每种 task kind 一条**固定线性**环节序列（流程收敛到可执行，不做自由 DAG）。
 * 由图纸配方（gates=暂停点 / enabledStages=已启用可选环节）经 {@link buildStages} 展开成
 * 建任务用的 `{name, gate}` 列表：api 建根任务（discover/recheck/analyze）、worker 建派生任务
 * （collect/analyze）都经此，确保同一 kind 的环节序列一致。
 *
 * 与流水线检视器（{@link ./inspect}）的关系：analyze 的 6 环节即检视器节点，复用其名表。
 */
import { INSPECT_STEP_NAMES } from './inspect';

/** 任务类型（与 DB tasks.kind 一致）。 */
export type TaskKind = 'discover' | 'collect' | 'recheck' | 'analyze' | 'translate';

/** 环节模板项：名称 + 可选 fetch lane 类别 + 是否可选环节。 */
export interface StageTemplate {
  name: string;
  /** fetch 类别：source=外站抓取（按帖来源解析 lane）/ ai=AI lane；本地处理则不填。供前端标注与请求闸分组。 */
  fetch?: 'source' | 'ai';
  /** 可选环节：默认不生成，仅当图纸 enabledStages 含其复合键 `kind:name` 时才进入运行（如 translate）。 */
  optional?: boolean;
}

/**
 * 每种 task kind 的固定可执行环节序列。
 * - discover：抓列表 → 去重 → 派生采集子任务
 * - collect：抓评论（落 jsonb 检查点）→ 落库（replaceComments + 派生 analyze）
 * - recheck：重抓评论 → 落库（指纹判变 + 退避 + 变则派生 analyze）
 * - analyze：检视器 6 节点（resolve→fetch→context→ai_call→normalize→persist）
 * - translate：单环节翻译（translate 任务专用；collect/recheck 的可选内联翻译为后续增强）
 */
export const STAGE_TEMPLATES: Record<TaskKind, StageTemplate[]> = {
  discover: [{ name: 'fetch_listing', fetch: 'source' }, { name: 'dedup' }, { name: 'spawn' }],
  collect: [{ name: 'fetch_comments', fetch: 'source' }, { name: 'persist' }],
  recheck: [{ name: 'recrawl', fetch: 'source' }, { name: 'persist' }],
  analyze: INSPECT_STEP_NAMES.map((name) => ({ name })),
  translate: [{ name: 'translate', fetch: 'ai' }],
};

/** 闸门 / 可选环节复合键 = 阶段(task kind) + 环节名。跨阶段同名环节（如多处 persist）借此互不串扰。 */
export function gateKey(kind: TaskKind, name: string): string {
  return `${kind}:${name}`;
}

/** 图纸配方里影响建环节的部分（gates=暂停点复合键、enabledStages=已启用可选环节复合键）。 */
export interface StageRecipe {
  gates?: string[];
  enabledStages?: string[];
}

/** 建任务用的环节定义：名称 + 是否挂暂停点（与 db 的 StageDef 同形）。 */
export interface BuiltStage {
  name: string;
  gate: boolean;
}

/**
 * 按 kind 模板 + 图纸配方展开任务环节：过滤未启用的可选环节、按 gates 复合键标暂停点。
 * @param kind 任务类型
 * @param recipe 图纸配方（gates / enabledStages）；缺省 = 无暂停点、不启用任何可选环节
 */
export function buildStages(kind: TaskKind, recipe?: StageRecipe): BuiltStage[] {
  const gates = recipe?.gates ?? [];
  const enabled = recipe?.enabledStages ?? [];
  return STAGE_TEMPLATES[kind]
    .filter((t) => !t.optional || enabled.includes(gateKey(kind, t.name)))
    .map((t) => ({ name: t.name, gate: gates.includes(gateKey(kind, t.name)) }));
}
