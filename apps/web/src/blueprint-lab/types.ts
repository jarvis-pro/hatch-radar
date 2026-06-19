/**
 * 图纸实验室（原型）契约类型 —— 单一事实源，后端落地时整体上移到 `@hatch-radar/shared`。
 *
 * 三层模型（本次设计修订的核心，见 docs/blueprint-lifecycle-design.md 待回写）：
 *   图纸 Blueprint（纯配方，无节奏） → 进程 Process（配方 + 节奏 + 启停，手动创建、常驻）
 *     → 运行 Run（进程每触发一次的执行实例）
 *
 * 关键点：**节奏（once/interval/cron）长在「进程」上，不在「图纸」上**。
 * 同一张图纸可以派生多个不同节奏的进程（「HN 每 30 分」与「HN 发布日每 5 分」共用一张图纸）。
 */

/** 图纸类型（配方种类）。analyze/maintenance 由事件派生或内务，原型不在此创建。 */
export type BlueprintKind = 'collect' | 'recheck';

/** 数据源种类。 */
export type SourceKind = 'reddit' | 'hackernews' | 'rss';

/** 图纸内的一个源选择：源种类 + 该源下的频道（subreddit / HN 列表 / RSS 订阅）。 */
export interface SourceSelection {
  kind: SourceKind;
  /** reddit: ['r/SaaS', …] · hackernews: ['front','new', …] · rss: 订阅标签/URL */
  channels: string[];
}

/** 采集图纸参数（只抓新帖；发现沿 new 时间线增量翻页，不再多排序维度）。 */
export interface CollectParams {
  /** 翻页抓取上限：单源单轮最多翻取的帖数（封顶兜底；正常由 stopAfterKnown 提前收口）。 */
  limit: number;
  /** 翻页停止规则：连续命中 K 条已知帖即停（增量收口）。 */
  stopAfterKnown: number;
  /** 每帖评论抓取预算。 */
  commentBudget: number;
}

/** 复查图纸参数（只查旧帖、探变化）。 */
export interface RecheckParams {
  /** 每批纳入的帖数。 */
  batchSize: number;
  /** 批间冷却（秒）。 */
  batchIntervalSec: number;
  /** 指数退避封顶跳过轮数（连续未变 → 跳过 1,2,4,…,CAP 个 sweep）。 */
  backoffCap: number;
}

/**
 * 流程节点：画布上的一个环节实例。
 * `type` 指向 STAGE_TYPES 里的环节类型（= 后端 task_stages.name，执行内核认识的环节）。
 */
export interface FlowNode {
  /** 画布内唯一 id（同一类型可放多个，故与 type 分离）。 */
  id: string;
  /** 环节类型标识（STAGE_TYPES.name）。 */
  type: string;
  /** 画布坐标。 */
  position: { x: number; y: number };
  /** 闸门：跑到此环节即暂停、等人工放行（逐环节停起的载体）。 */
  gate?: boolean;
}

/** 流程连线：有向边 source → target，表达环节先后 / 派生关系。 */
export interface FlowEdge {
  /** 边唯一 id。 */
  id: string;
  /** 源节点 id。 */
  source: string;
  /** 目标节点 id。 */
  target: string;
}

/**
 * 图纸流程（DAG）：节点 + 连线。取代写死的「固定环节模板」——
 * 用户在连线编辑器里自由编排：增删环节、连任意线（可分支 / 合并 / 并行）、逐环节挂闸门。
 */
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** 图纸 = 纯配方（哪个源 + 采集/复查 + 参数 + 执行流程），**不含节奏**。 */
export interface Blueprint {
  id: string;
  kind: BlueprintKind;
  label: string;
  /** 配方说明（可选，给人看的一句话）。 */
  note?: string;
  sources: SourceSelection[];
  params: CollectParams | RecheckParams;
  /** 执行流程（DAG）：用户在连线编辑器里自定义的环节图。 */
  flow: FlowGraph;
  createdAt: number;
  updatedAt: number;
}

/** 触发方式（节奏）—— 长在进程上。 */
export type TriggerKind = 'once' | 'interval' | 'cron';

/** 触发配置（判别联合）。 */
export type TriggerConfig =
  | { kind: 'once' }
  /** 间隔：上一轮完成后冷却 everySec 再开下一轮（结构上不堆积、随吞吐自适应）。 */
  | { kind: 'interval'; everySec: number }
  /** 定时：cron 表达式（原型用友好串占位）。 */
  | { kind: 'cron'; expr: string };

/** 进程状态。active=调度中 / paused=手动暂停 / completed=once 跑完或已停止。 */
export type ProcessStatus = 'active' | 'paused' | 'completed';

/** 进程 = 图纸绑定 + 节奏 + 启停，由用户手动创建、常驻调度。 */
export interface Process {
  id: string;
  blueprintId: string;
  /** 进程名（默认派生自图纸 + 节奏，可改）。 */
  label: string;
  trigger: TriggerConfig;
  status: ProcessStatus;
  createdAt: number;
  /** 最近一次触发时刻（ms）；从未触发为 null。 */
  lastRunAt: number | null;
  /** 下次预计触发时刻（ms）；paused/once 已完成为 null。 */
  nextRunAt: number | null;
  /** 复查 sweep 计数（仅 recheck 有意义，驱动退避到期判定）。 */
  sweepSeq: number;
  /** 累计运行数。 */
  runsTotal: number;
}

/** 运行状态。 */
export type RunStatus = 'running' | 'completed' | 'failed' | 'canceled' | 'paused';

/**
 * 运行触发来源（对应后端 `runs.trigger_source`）。
 * manual=人工「立即触发」；interval/cron=调度器按进程节奏触发。同一进程的不同运行可来源不同。
 */
export type RunTrigger = 'manual' | 'interval' | 'cron';

/** 运行 = 进程每触发一次的执行实例（含任务计数快照）。 */
export interface Run {
  id: string;
  processId: string;
  blueprintId: string;
  kind: BlueprintKind;
  status: RunStatus;
  /** 本次运行的触发来源（手动「立即触发」vs 调度器按节奏触发）。 */
  triggerSource: RunTrigger;
  /** 失败原因（status='failed' 时有值，给人看的一句话）；其余为 null。 */
  error: string | null;
  /** 复查 sweep 序号（非复查为 null）。 */
  sweepSeq: number | null;
  tasksTotal: number;
  tasksDone: number;
  tasksSkipped: number;
  tasksFailed: number;
  startedAt: number;
  finishedAt: number | null;
}

// ─── 运行下钻：任务 / 环节（对应后端 tasks / task_stages，运行详情星图用） ─────────────

/** 任务种类（discover/collect/recheck/analyze/translate）。 */
export type TaskKind = 'discover' | 'collect' | 'recheck' | 'analyze' | 'translate';

/** 任务状态。 */
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'canceled';

/** 环节状态。 */
export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'paused';

/** 一条评论（树形，含嵌套子评论）——给任务挂真实感的评论数据。 */
export interface MockComment {
  author: string;
  score: number;
  /** 嵌套深度（0 = 顶层，构建时按树层级回填）。 */
  depth: number;
  body: string;
  children?: MockComment[];
}

/** 一条帖子（mock 语料）：任务的真实内容载体，覆盖长短/各来源/评论深浅。 */
export interface MockPost {
  /** Reddit 风格 id（t3_xxx）。 */
  id: string;
  source: SourceKind;
  /** 频道：reddit=r/版块 · hackernews=front/new · rss=订阅名。 */
  channel: string;
  title: string;
  /** 正文（链接帖 / 多数 HN 帖为空串）。 */
  body: string;
  author: string;
  /** 赞同 / 分数。 */
  score: number;
  /** 评论总数（可远大于 comments 预览）。 */
  numComments: number;
  /** 评论树最深层级（0 = 无评论 / 仅顶层）。 */
  commentDepth: number;
  /** 发布距今分钟数（渲染时换算相对时间）。 */
  ageMinutes: number;
  /** 评论树预览（采样，不必等于 numComments）。 */
  comments: MockComment[];
}

/** 环节 = 任务内的有名步骤；每步落检查点产物，可挂闸门。 */
export interface Stage {
  /** 任务内序号（0 起）。 */
  seq: number;
  /** 环节名（= 后端 task_stages.name，执行内核认识的环节）。 */
  name: string;
  status: StageStatus;
  /** 闸门：跑完此环节即暂停、等人工放行。 */
  gate: boolean;
  /** 产物摘要（检查点 jsonb 的展示侧，给人看的一句话）；未产出为 null。 */
  output: string | null;
  /** 失败原因（status='failed' 时有值）。 */
  error: string | null;
}

/** 任务 = 工作单元（绝大多数 = 1 帖），按血缘 parentId 成树。 */
export interface Task {
  id: string;
  runId: string;
  kind: TaskKind;
  status: TaskStatus;
  /** 血缘父任务 id（根任务为 null，挂在运行下）。 */
  parentId: string | null;
  /** 目标帖子 id（discover 任务为 null）。 */
  postId: string | null;
  /** 帖子内容（collect/recheck/analyze 任务挂载；discover 任务为 null）。 */
  post: MockPost | null;
  stages: Stage[];
}

/** 运行详情 = 运行 + 其任务树（每任务含环节）。 */
export interface RunDetail {
  run: Run;
  tasks: Task[];
}

/** 某进程的运行聚合统计（运行记录页头指标条用，对应后端一个聚合端点）。 */
export interface RunStats {
  /** 累计运行数。 */
  total: number;
  /** 完成数。 */
  completed: number;
  /** 失败数。 */
  failed: number;
  /** 进行中数。 */
  running: number;
  /** 成功率 = 完成 /（完成 + 失败）；无已结算运行为 null。 */
  successRate: number | null;
  /** 平均耗时（秒），仅对已结束运行求均值；无已结束运行为 null。 */
  avgDurationSec: number | null;
  /** 最近一次失败时刻（ms）；从无失败为 null。 */
  lastFailedAt: number | null;
}
