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
