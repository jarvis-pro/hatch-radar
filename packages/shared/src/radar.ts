/**
 * 雷达指挥室（radar）跨端契约 DTO —— api 产出、web 消费，单一事实源。
 *
 * 对齐 `apps/web/src/radar-lab` 的视图模型，但用**服务端口径**：id 用数字（DB 自增）、
 * 帖子 id 用字符串、时间戳用 Unix 秒。列表端点统一走 {@link ./api Paged}。
 */
import type { TaskKind } from './stages';

export type RadarSourceKind = 'reddit' | 'hackernews' | 'rss';
export type RadarLaneId = RadarSourceKind | 'ai';
export type BlueprintKind = 'collect' | 'recheck';
export type ProcessStatus = 'active' | 'paused';
export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'canceled';
export type RadarTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'canceled';
export type StageStatus = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';
export type RadarIntensity = 'high' | 'medium' | 'low';
export type { TaskKind };

/** 触发配置（进程节奏）。 */
export type TriggerConfig =
  | { kind: 'once' }
  | { kind: 'interval'; everySec: number }
  | { kind: 'cron'; expr: string };

/** 图纸来源筛选项。 */
export interface BlueprintSource {
  kind: RadarSourceKind;
  channels: string[];
}

/** 图纸 DTO（纯配方）。 */
export interface BlueprintDTO {
  id: number;
  kind: BlueprintKind;
  label: string;
  note: string | null;
  sources: BlueprintSource[];
  /** 业务参数（采集 limit/stopAfterKnown/commentBudget；复查 batchSize/backoffCap…）。 */
  params: Record<string, unknown>;
  /** 暂停点复合键 `kind:stage`。 */
  gates: string[];
  /** 已启用的可选环节复合键。 */
  enabledStages: string[];
  createdAt: number;
  updatedAt: number;
}

/** 进程 DTO（图纸 + 触发节奏）。 */
export interface ProcessDTO {
  id: number;
  blueprintId: number;
  blueprintKind: BlueprintKind;
  label: string;
  trigger: TriggerConfig;
  status: ProcessStatus;
  sweepSeq: number;
  runsTotal: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

/** 运行环节视图。 */
export interface StageDTO {
  seq: number;
  name: string;
  status: StageStatus;
  gate: boolean;
  /** fetch 类环节的 lane（按帖来源 / ai 现算，本地环节为 null）。 */
  lane: RadarLaneId | null;
  /** 环节产物摘要（人话，展示用）。 */
  output: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/** 任务视图（含环节轨迹）。 */
export interface TaskDTO {
  id: number;
  runId: number;
  kind: TaskKind;
  status: RadarTaskStatus;
  parentTaskId: number | null;
  postId: string | null;
  postTitle: string | null;
  model: string | null;
  attempts: number;
  error: string | null;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  stages: StageDTO[];
}

/** 运行 DTO。 */
export interface RunDTO {
  id: number;
  processId: number | null;
  processLabel: string | null;
  blueprintId: number;
  blueprintLabel: string | null;
  kind: BlueprintKind | string;
  status: RunStatus | string;
  triggerSource: string;
  sweepSeq: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  tasksTotal: number;
  tasksDone: number;
  tasksSkipped: number;
  tasksFailed: number;
}

/** 请求队列行（最近请求展示）。 */
export interface RequestRowDTO {
  id: number;
  lane: RadarLaneId | string;
  purpose: string;
  ownerTaskId: number | null;
  status: 'pending' | 'running' | 'done' | 'failed' | 'canceled' | string;
  detail: string;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** lane 概览卡。 */
export interface LaneDTO {
  id: RadarLaneId | string;
  label: string;
  ratePerMin: number;
  paused: boolean;
  /** 最近 60s 实际放行速率（次/分）。 */
  rate: number;
  /** 队列深度（pending + running）。 */
  depth: number;
  /** 预计排空秒数（depth/rate*60）；rate=0 时 null。 */
  etaSec: number | null;
  recent: RequestRowDTO[];
}

/** 洞察行（收成研判台）。 */
export interface RadarInsightDTO {
  id: number;
  postId: string;
  source: RadarSourceKind | string;
  channel: string;
  postTitle: string;
  /** 译文标题（translations 按 title_hash 预 join；无则 null）。 */
  titleZh: string | null;
  intensity: RadarIntensity;
  painPoint: string;
  tags: string[];
  oppCount: number;
  createdAt: number;
}

/** 洞察详情里的痛点（radar 口径：小写强度）。 */
export interface RadarPainPoint {
  description: string;
  /** 原文引用片段（保留原语言）。 */
  evidence: string;
  intensity: RadarIntensity;
}

/** 洞察详情里的产品机会。 */
export interface RadarOpportunity {
  title: string;
  description: string;
  targetUser: string;
}

/** 人工研判（移动端同步落库）。 */
export interface RadarTriage {
  status: 'pending' | 'shortlisted' | 'archived';
  rating: number | null;
  tags: string[];
  note: string;
  updatedAt: number;
}

/** 单条洞察详情（GET /api/radar/insights/:id）—— 痛点 / 机会 / 研判全展开。 */
export interface RadarInsightDetailDTO {
  id: number;
  postId: string;
  source: RadarSourceKind | string;
  channel: string;
  postTitle: string;
  titleZh: string | null;
  permalink: string | null;
  model: string;
  intensity: RadarIntensity;
  painPoints: RadarPainPoint[];
  opportunities: RadarOpportunity[];
  tags: string[];
  /** 人工研判；从未研判则 null。 */
  triage: RadarTriage | null;
  /** 源帖是否仍在库（可下钻「帖子一生」）。 */
  postExists: boolean;
  createdAt: number;
}

/** 来源 / 版块去重清单（筛选下拉 + 导出批次共用）。 */
export interface RadarFilterOptions {
  sources: string[];
  subreddits: string[];
}

/** 帖子库行 / 详情头。 */
export interface RadarPostDTO {
  id: string;
  source: RadarSourceKind | string;
  channel: string;
  title: string;
  titleZh: string | null;
  body: string;
  bodyZh: string | null;
  titleHash: string | null;
  selftextHash: string | null;
  author: string | null;
  score: number;
  numComments: number;
  createdUtc: number;
  recheckMisses: number;
  recheckDueSweep: number;
  lastRecheckedAt: number | null;
  analyzed: boolean;
}

/** 评论树节点。 */
export interface RadarCommentDTO {
  id: string;
  author: string | null;
  score: number;
  depth: number;
  body: string;
  bodyHash: string | null;
  createdUtc: number;
  children: RadarCommentDTO[];
}

/** 帖子一生时间线事件（跨运行）。 */
export interface PostLifecycleEvent {
  taskId: number;
  runId: number;
  kind: TaskKind;
  status: RadarTaskStatus;
  sweepSeq: number | null;
  at: number;
}

/** 帖子详情聚合（GET /api/radar/posts/:id）。 */
export interface RadarPostDetailDTO {
  post: RadarPostDTO;
  comments: RadarCommentDTO[];
  events: PostLifecycleEvent[];
  insights: RadarInsightDTO[];
}

/** 指挥室聚合（GET /api/radar/control-room）。 */
export interface ControlRoomDTO {
  /** workers = 当前在线 Worker 数（顶栏系统脉搏复用）。 */
  today: { insights: number; posts: number; runs: number; inflight: number; workers: number };
  lanes: LaneDTO[];
  processes: (ProcessDTO & {
    /** 当前进行中的运行（无则 null）。 */
    activeRun: { id: number; tasksTotal: number; tasksDone: number; tasksFailed: number } | null;
  })[];
  /** 最近失败的运行（告警条）。 */
  alerts: RunDTO[];
  /** 复查退避分布：按 recheck_misses 分桶。 */
  recheck: { sweep: number; dueNow: number; dist: { misses: number; count: number }[] };
}

/** 收成洞察筛选 / 排序。 */
export interface RadarInsightFilter {
  source?: string;
  subreddit?: string;
  intensity?: RadarIntensity;
  processId?: number;
  q?: string;
  sort?: 'time' | 'pain';
  page?: number;
  size?: number;
}

/** 帖子库筛选。 */
export interface RadarPostFilter {
  source?: string;
  subreddit?: string;
  /** 复查状态：due=到期可查 / quiet=退避中 / new=未复查过。 */
  status?: 'due' | 'quiet' | 'new';
  q?: string;
  page?: number;
  size?: number;
}
