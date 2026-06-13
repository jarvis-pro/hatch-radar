import { Inject, Injectable } from '@nestjs/common';
import { and, gte, isNull, lt, sql } from 'drizzle-orm';
import { comments, insights, posts, type AppDatabase } from '@hatch-radar/db';
import { DRIZZLE } from '../common/tokens';

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
@Injectable()
export class StatsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: AppDatabase) {}

  /**
   * 返回数据库各表的当前行数汇总。
   * @returns posts / comments / 待分析帖子数 / insights 的当前计数
   */
  async getStats(): Promise<DbStats> {
    const n = (rows: { n: number }[]): number => rows[0].n;
    const countExpr = sql<number>`count(*)::int`;
    const [postsN, commentsN, pendingN, insightsN] = await Promise.all([
      this.db.select({ n: countExpr }).from(posts),
      this.db.select({ n: countExpr }).from(comments),
      this.db
        .select({ n: countExpr })
        .from(posts)
        .where(
          and(isNull(posts.analyzed_at), gte(posts.comment_pass, 1), lt(posts.analyze_attempts, 3)),
        ),
      this.db.select({ n: countExpr }).from(insights),
    ]);
    return {
      posts: n(postsN),
      comments: n(commentsN),
      pendingAnalysis: n(pendingN),
      insights: n(insightsN),
    };
  }
}
