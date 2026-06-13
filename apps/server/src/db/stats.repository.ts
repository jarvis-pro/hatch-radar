import { Inject, Injectable } from '@nestjs/common';
import type { AppDatabase } from '@hatch-radar/db';
import { PRISMA } from '../common/tokens';

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
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 返回数据库各表的当前行数汇总。
   * @returns posts / comments / 待分析帖子数 / insights 的当前计数
   */
  async getStats(): Promise<DbStats> {
    const [posts, comments, pendingAnalysis, insights] = await Promise.all([
      this.db.posts.count(),
      this.db.comments.count(),
      this.db.posts.count({
        where: { analyzed_at: null, comment_pass: { gte: 1 }, analyze_attempts: { lt: 3 } },
      }),
      this.db.insights.count(),
    ]);
    return { posts, comments, pendingAnalysis, insights };
  }
}
