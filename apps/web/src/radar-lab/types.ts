/**
 * 雷达指挥室（radar-lab，全新 mock）—— 契约类型。单一事实源。
 *
 * 与旧 blueprint-lab 的根本区别：这里不是「确定性快照拼装」，而是一个**会自己演进的世界**
 * （{@link World} + engine.tick + store 时钟）。所有页面都是 World 的视图，所有操作回写 World。
 *
 * 模型分层：图纸 Blueprint（纯配方）→ 进程 Process（配方 + 节奏 + 启停）
 *   → 运行 Run（进程每触发一次）→ 任务 Task（=1 帖）→ 环节 Stage（检查点 + 闸门）。
 * 横切：请求闸 Lane / RequestRow（所有外站请求的共享收口）；回点：Insight（产出）。
 */

// ─── 基础枚举 ──────────────────────────────────────────────────────────────────

export type SourceKind = 'reddit' | 'hackernews' | 'rss';
/** 限速分组（请求闸按目标分桶）。source 三道 + ai 一道。 */
export type LaneId = 'reddit' | 'hackernews' | 'rss' | 'ai';
export type BlueprintKind = 'collect' | 'recheck';
export type TaskKind = 'discover' | 'collect' | 'recheck' | 'analyze';
export type TriggerKind = 'once' | 'interval' | 'cron';

export type ProcessStatus = 'active' | 'paused';
export type RunStatus = 'running' | 'completed' | 'failed' | 'canceled';
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'canceled';
/** 环节状态。waiting = 停在 fetch 环节、等请求闸放行（park 的可视化）。 */
export type StageStatus = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';
export type RequestStatus = 'pending' | 'running' | 'done' | 'failed';
export type Intensity = 'high' | 'medium' | 'low';

// ─── 内容（语料） ──────────────────────────────────────────────────────────────

export interface Comment {
  author: string;
  score: number;
  /** 嵌套深度（0 = 顶层）。 */
  depth: number;
  body: string;
  /** 评论正文中文译文。 */
  bodyZh?: string;
  /** 评论年龄（分钟，相对帖子发布；比帖子新、回复比父评论新）。用于显示「X 前」。 */
  ageMinutes?: number;
  children?: Comment[];
}

export interface Post {
  id: string;
  source: SourceKind;
  /** reddit=r/版块 · hackernews=front/new · rss=订阅名。 */
  channel: string;
  title: string;
  /** 标题中文译文（有则视为「已翻译」）。 */
  titleZh?: string;
  body: string;
  /** 正文中文译文。 */
  bodyZh?: string;
  author: string;
  score: number;
  /** 源站评论计数（复查基线即此值）。 */
  numComments: number;
  commentDepth: number;
  /** 发布距种子时刻的分钟数。 */
  ageMinutes: number;
  comments: Comment[];
  /** 复查记账（可选，缺省视为 0）：连续未变次数。 */
  recheckMisses?: number;
  /** 下次有资格被复查的 sweep 序号（recheckDueSweep ≤ 当前 sweep 即到期）。 */
  recheckDueSweep?: number;
  /** 最近一次被复查的 sweep。 */
  lastRecheckedSweep?: number;
}

// ─── 定义层：图纸 / 进程 ────────────────────────────────────────────────────────

export type TriggerConfig =
  | { kind: 'once' }
  | { kind: 'interval'; everySec: number }
  | { kind: 'cron'; expr: string };

export interface CollectParams {
  limit: number;
  stopAfterKnown: number;
  commentBudget: number;
}
export interface RecheckParams {
  batchSize: number;
  batchIntervalSec: number;
  backoffCap: number;
}

/** 图纸 = 纯配方（源 + 采集/复查 + 参数 + 默认挂闸的环节），不含节奏。 */
export interface Blueprint {
  id: string;
  kind: BlueprintKind;
  label: string;
  note?: string;
  sources: { kind: SourceKind; channels: string[] }[];
  params: CollectParams | RecheckParams;
  /** 默认挂闸门的环节复合键 `kind:name` 集合（配方级 gate；运行时落到具体 Stage.gate）。 */
  gates: string[];
  /**
   * 已启用的「可选环节」复合键 `kind:name` 集合（如翻译；默认空 = 不启用）。
   * 缺省或未含某可选环节 → 运行时根本不生成该环节（engine.buildStages 据此过滤），
   * 对应真实后端「默认不翻、按需开启」。区别于 {@link gates}（挂闸=跑到此暂停等放行）。
   */
  enabledStages?: string[];
}

/** 进程 = 图纸 + 节奏 + 启停，常驻调度。 */
export interface Process {
  id: string;
  blueprintId: string;
  label: string;
  trigger: TriggerConfig;
  status: ProcessStatus;
  lastRunAt: number | null;
  nextRunAt: number | null;
  /** 复查 sweep 计数（仅 recheck 有意义）。 */
  sweepSeq: number;
  runsTotal: number;
}

// ─── 执行层：运行 / 任务 / 环节 ─────────────────────────────────────────────────

export interface Stage {
  seq: number;
  /** 环节名（执行内核认识，= 后端 task_stages.name）。 */
  name: string;
  status: StageStatus;
  /** 闸门：到此环节即暂停、等放行（放行即消耗，置 false）。 */
  gate: boolean;
  /** 工作耗时预算（ms，sim 时间）。 */
  costMs: number;
  /** 已累计耗时（ms）。 */
  elapsedMs: number;
  /** fetch 环节的目标 lane（经请求闸）；非 fetch 为 undefined。 */
  lane?: LaneId;
  /** 当前关联的请求行 id（fetch 环节 waiting/running 时）。 */
  requestId?: string;
  /** 产物摘要（给人看的一句话）。 */
  output: string | null;
  error: string | null;
}

export interface Task {
  id: string;
  runId: string;
  processId: string;
  kind: TaskKind;
  status: TaskStatus;
  /** 血缘父任务（discover→collect→analyze）；根任务为 null。 */
  parentId: string | null;
  /** 目标帖（discover 为 null）。 */
  postId: string | null;
  /** 帖内容引用（与 world.posts 同一对象，保持一致）；discover 为 null。 */
  post: Post | null;
  stages: Stage[];
  attempts: number;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface Run {
  id: string;
  processId: string;
  blueprintId: string;
  kind: BlueprintKind;
  status: RunStatus;
  triggerSource: 'manual' | 'interval' | 'cron';
  /** 复查 sweep 序号（非复查为 null）。 */
  sweepSeq: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

// ─── 横切：请求闸 ───────────────────────────────────────────────────────────────

export interface RequestRow {
  id: string;
  lane: LaneId;
  /** 用途：listing | detail | comments | probe | recrawl | ai_call。 */
  purpose: string;
  taskId: string;
  stageSeq: number;
  postId: string | null;
  status: RequestStatus;
  /** 工作耗时（= owner 环节 costMs）。 */
  costMs: number;
  enqueuedAt: number;
  releasedAt: number | null;
  finishedAt: number | null;
  /** 展示用一句话（如 "r/SaaS · new p.1"）。 */
  detail: string;
}

/** lane 限速 + 暂停配置 + 滚动统计。 */
export interface Lane {
  id: LaneId;
  label: string;
  ratePerMin: number;
  burst: number;
  /** 当前令牌数。 */
  tokens: number;
  paused: boolean;
  /** 最近放行时刻（sim ms）滚动窗，用于算实时速率。 */
  recentReleases: number[];
}

// ─── 回点：洞察产出 ─────────────────────────────────────────────────────────────

export interface Insight {
  id: string;
  postId: string;
  /** 溯源：哪次运行 / 哪条进程 / 哪张图纸产出的（闭环回点的关键）。 */
  runId: string;
  processId: string;
  blueprintId: string;
  source: SourceKind;
  channel: string;
  postTitle: string;
  intensity: Intensity;
  /** 首要痛点摘要。 */
  painPoint: string;
  tags: string[];
  painCount: number;
  oppCount: number;
  createdAt: number;
}

// ─── 世界 ───────────────────────────────────────────────────────────────────────

/** 单一可变世界状态。engine.tick 推进它，store 订阅它。 */
export interface World {
  /** 模拟时钟（sim ms）。所有相对时间相对它算，而非 wall clock。 */
  nowMs: number;
  blueprints: Blueprint[];
  processes: Process[];
  runs: Run[];
  tasks: Task[];
  requests: RequestRow[];
  lanes: Lane[];
  insights: Insight[];
  /** 已入库（已采集）的帖。 */
  posts: Post[];
  /** 尚未被发现的帖池——discover 从这里「发现新帖」。 */
  undiscovered: Post[];
  /** 自增 id 计数。 */
  seq: number;
}
