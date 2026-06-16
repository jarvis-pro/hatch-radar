/**
 * 通用 API 形状（分页 / 筛选选项）——server 只读数据端点产出、web 列表页消费。
 * 纯类型，零运行时依赖。
 */

/** 列表页统一分页大小（server 取数与 web 展示同口径）。 */
export const PAGE_SIZE = 20;

/** 分页查询结果。 */
export interface Paged<T> {
  items: T[];
  /** 满足筛选条件的总条数。 */
  total: number;
  /** 实际生效的页码（越界时收敛到合法区间）。 */
  page: number;
  pageCount: number;
}

/** 筛选下拉可选项（来源 / 版块去重清单）。 */
export interface FilterOptions {
  sources: string[];
  subreddits: string[];
}

/** 概览计数（首页统计卡片 / 健康检查同口径）。 */
export interface DbStats {
  posts: number;
  comments: number;
  pendingAnalysis: number;
  insights: number;
}

/** 看板：单个在线 Worker 的运行状态 */
export interface WorkerStatus {
  workerId: string;
  concurrency: number;
  activeJobs: number;
  /** CPU 占用百分比（worker 上报） */
  cpu: number;
  /** 内存占用百分比（worker 上报） */
  memory: number;
  /** 距最近心跳的秒数 */
  lastHeartbeatAgo: number;
}

/** 看板：某模型在统计窗内的 token 用量与成本 */
export interface CostByModel {
  provider: string;
  model: string;
  jobs: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** 折算成本（美元）；该模型未配单价时为 null */
  cost: number | null;
}

/** 看板：某日完成的分析数（YYYY-MM-DD） */
export interface ThroughputPoint {
  date: string;
  count: number;
}

/** 看板：名称 + 计数（强度分布 / Top 版块共用） */
export interface NamedCount {
  name: string;
  count: number;
}

/** 看板聚合数据（GET /api/dashboard） */
export interface DashboardData {
  overview: DbStats;
  queue: { queued: number; running: number; succeeded: number; failed: number; canceled: number };
  workers: WorkerStatus[];
  cost: {
    /** 统计窗口（天） */
    windowDays: number;
    /** 窗口内总成本（美元）；全部模型都未配单价时为 null */
    totalCost: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    byModel: CostByModel[];
  };
  throughput: ThroughputPoint[];
  insights: { byIntensity: NamedCount[]; topSubreddits: NamedCount[] };
}
