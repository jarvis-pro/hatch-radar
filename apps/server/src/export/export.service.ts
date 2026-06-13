import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  toCommentRow,
  toInsightRow,
  toPostRow,
  type AppDatabase,
  type InsightPgRow,
} from '@hatch-radar/db';
import {
  EXPORT_FORMAT_VERSION,
  type CommentRow,
  type ExportBatch,
  type ExportFilter,
  type PostRow,
} from '@hatch-radar/shared';
import { PRISMA } from '../common/tokens';
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
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 按条件从主库筛出一个导出批次。
   * @param filter 批次筛选条件
   */
  async collectBatch(filter: ExportFilter): Promise<ExportBatch> {
    const conds: Prisma.Sql[] = [
      Prisma.sql`(jsonb_array_length(pain_points) > 0 OR jsonb_array_length(opportunities) > 0)`,
    ];
    if (filter.since) conds.push(Prisma.sql`created_at > ${BigInt(filter.since)}`);
    if (filter.minIntensity === 'HIGH') conds.push(Prisma.sql`intensity::text = 'HIGH'`);
    if (filter.minIntensity === 'MEDIUM') {
      conds.push(Prisma.sql`intensity::text IN ('HIGH', 'MEDIUM')`);
    }
    if (filter.subreddit) {
      conds.push(Prisma.sql`lower(subreddit) = lower(${filter.subreddit})`);
    }
    const where = Prisma.join(conds, ' AND ');
    const limit = filter.limit ? Prisma.sql`LIMIT ${filter.limit}` : Prisma.empty;
    const insightRows = await this.db.$queryRaw<InsightPgRow[]>`
      SELECT * FROM insights
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      ${limit}
    `;

    const postRows: PostRow[] = [];
    const commentRows: CommentRow[] = [];
    for (const ins of insightRows) {
      const post = await this.db.posts.findUnique({ where: { id: ins.post_id } });
      if (!post) continue;
      postRows.push(toPostRow(post));
      const cs = await this.db.comments.findMany({
        where: { post_id: post.id },
        orderBy: [{ created_utc: 'asc' }, { id: 'asc' }],
      });
      for (const c of cs) commentRows.push(toCommentRow(c));
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
