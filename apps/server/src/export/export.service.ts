import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { comments, insights, posts, toInsightRow, type AppDatabase } from '@hatch-radar/db';
import {
  EXPORT_FORMAT_VERSION,
  type CommentRow,
  type ExportBatch,
  type ExportFilter,
  type PostRow,
} from '@hatch-radar/shared';
import { DRIZZLE } from '../common/tokens';
import { nowSec } from '../common/time';

/**
 * 导出批次收集（数据源 = PG）。
 *
 * 「有效数据」基线：洞察必须有实质信号（痛点或机会非空），在此之上叠加可选筛选。
 * 关联帖子已被 30 天归档清理时仅导出洞察本身（post_id 为软引用，移动端按缺失处理）。
 * jsonb 字段经 toInsightRow stringify 回 TEXT，产出的 InsightRow 与裸跑实现字节级一致。
 */
@Injectable()
export class ExportService {
  constructor(@Inject(DRIZZLE) private readonly db: AppDatabase) {}

  /**
   * 按条件从主库筛出一个导出批次。
   * @param filter 批次筛选条件
   */
  async collectBatch(filter: ExportFilter): Promise<ExportBatch> {
    const conds: SQL[] = [
      sql`(jsonb_array_length(${insights.pain_points}) > 0 OR jsonb_array_length(${insights.opportunities}) > 0)`,
    ];
    if (filter.since) conds.push(sql`${insights.created_at} > ${filter.since}`);
    if (filter.minIntensity === 'HIGH') conds.push(sql`${insights.intensity}::text = 'HIGH'`);
    if (filter.minIntensity === 'MEDIUM') {
      conds.push(sql`${insights.intensity}::text IN ('HIGH', 'MEDIUM')`);
    }
    if (filter.subreddit)
      conds.push(sql`lower(${insights.subreddit}) = lower(${filter.subreddit})`);

    let query = this.db
      .select()
      .from(insights)
      .where(and(...conds))
      .orderBy(desc(insights.created_at), desc(insights.id))
      .$dynamic();
    if (filter.limit) query = query.limit(filter.limit);
    const insightRows = await query;

    const postRows: PostRow[] = [];
    const commentRows: CommentRow[] = [];
    for (const ins of insightRows) {
      const post = (
        await this.db.select().from(posts).where(eq(posts.id, ins.post_id)).limit(1)
      )[0];
      if (!post) continue;
      postRows.push(post);
      const cs = await this.db
        .select()
        .from(comments)
        .where(eq(comments.post_id, post.id))
        .orderBy(asc(comments.created_utc), asc(comments.id));
      commentRows.push(...cs);
    }

    return {
      meta: {
        formatVersion: EXPORT_FORMAT_VERSION,
        exportedAt: nowSec(),
        filter,
        counts: {
          insights: insightRows.length,
          posts: postRows.length,
          comments: commentRows.length,
        },
      },
      insights: insightRows.map(toInsightRow),
      posts: postRows,
      comments: commentRows,
    };
  }
}
