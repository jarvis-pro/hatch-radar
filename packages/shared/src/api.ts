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

/** 看板：某日吞吐与产出（YYYY-MM-DD，0 填充的密集序列） */
export interface ThroughputPoint {
  date: string;
  /** 当天完成（成功）的分析数 */
  succeeded: number;
  /** 当天失败的分析数 */
  failed: number;
  /** 当天产出的高强度洞察数（洞察总数 = high + medium + low） */
  insightsHigh: number;
  insightsMedium: number;
  insightsLow: number;
}

/** 看板：某日的 token 用量与折算成本（YYYY-MM-DD，0 填充的密集序列） */
export interface DailyCostPoint {
  date: string;
  /** 当天折算成本（美元）；当天没有任何带单价的模型 → null（只统计用量、不折算） */
  cost: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/** 看板：名称 + 计数（强度分布 / Top 版块共用） */
export interface NamedCount {
  name: string;
  count: number;
}

/** 价值看板时间窗口（前端切片 + 后端过滤同口径）。 */
export type BoardRange = 'all' | 'today' | '7d' | '30d';

/** 价值看板：某日新增洞察数（YYYY-MM-DD，0 填充的密集序列）。 */
export interface FunnelTrendPoint {
  date: string;
  insights: number;
}

/** 价值看板：来源洞察力（产出计数 + 验证率；研判上线前 verifiedRate 恒为 null）。 */
export interface BoardSource {
  name: string;
  count: number;
  /** 该来源洞察的人工 / AI 验证率（0–1）；研判功能上线前为 null（预留）。 */
  verifiedRate: number | null;
}

/**
 * 价值看板聚合（GET /api/dashboard?range=）——「雷达发现并验证了多少真实需求」。
 * 价值漏斗（采集 → 分析 → 洞察，验证预留）+ 每日趋势 + 洞察质量 + 来源洞察力 + ROI。
 * 运营指标（队列 / Worker / 吞吐 / 成本明细）已切分至指挥室（GET /api/radar/control-room）。
 */
export interface BoardData {
  /** 价值漏斗计数（验证阶段无数据，前端占位）。 */
  funnel: { collected: number; analyzed: number; insights: number };
  /** 每日新增洞察趋势（密集序列）。 */
  funnelTrend: FunnelTrendPoint[];
  /** 洞察质量：强度分布 + 热门标签。 */
  quality: { byIntensity: NamedCount[]; topTags: NamedCount[] };
  /** 来源洞察力。 */
  sources: BoardSource[];
  /** 投入产出：每洞察成本（窗口成本 / 洞察数；无带单价模型或窗口内无洞察时为 null）。 */
  roi: { costPerInsight: number | null };
}
