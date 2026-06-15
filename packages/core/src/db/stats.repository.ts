import type { AppDatabase } from '@hatch-radar/db';
import { PENDING_ANALYSIS_PREDICATE } from './posts.repository';

/** 数据库各表计数概览 */
export interface DbStats {
  posts: number;
  comments: number;
  pendingAnalysis: number;
  insights: number;
}

/**
 * 计数概览数据访问，用于启动日志、健康检查与监控。
 */
export class StatsRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * 返回数据库各表的当前行数汇总。
   * - 单条 SQL 一次往返取全部计数（health 探测每次都会调，避免 4 次独立查询）
   * - 待分析口径复用 {@link PENDING_ANALYSIS_PREDICATE}，与实际入队取数完全一致
   * @returns posts / comments / 待分析帖子数 / insights 的当前计数
   */
  async getStats(): Promise<DbStats> {
    const [row] = await this.db.$queryRaw<
      { posts: bigint; comments: bigint; pending: bigint; insights: bigint }[]
    >`
      SELECT
        (SELECT count(*) FROM posts) AS posts,
        (SELECT count(*) FROM comments) AS comments,
        (SELECT count(*) FROM posts WHERE ${PENDING_ANALYSIS_PREDICATE}) AS pending,
        (SELECT count(*) FROM insights) AS insights
    `;
    return {
      posts: Number(row?.posts ?? 0),
      comments: Number(row?.comments ?? 0),
      pendingAnalysis: Number(row?.pending ?? 0),
      insights: Number(row?.insights ?? 0),
    };
  }
}
