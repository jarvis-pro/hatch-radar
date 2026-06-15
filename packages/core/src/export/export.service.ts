import {
  Prisma,
  toCommentRow,
  toInsightRow,
  toPostRow,
  type AppDatabase,
  type CommentPg,
  type InsightPgRow,
  type PostPg,
} from '@hatch-radar/db';
import {
  EXPORT_FORMAT_VERSION,
  type CommentRow,
  type ExportBatch,
  type ExportFilter,
  type PostRow,
} from '@hatch-radar/shared';
import { nowSec } from '@hatch-radar/kernel';

/**
 * 导出批次收集（数据源 = PG）。
 *
 * 「有效数据」基线：洞察必须有实质信号（痛点或机会非空），在此之上叠加可选筛选。
 * 关联帖子已被 30 天归档清理时仅导出洞察本身（post_id 为软引用，移动端按缺失处理）。
 * jsonb 字段经 toInsightRow stringify 回 TEXT，产出的 InsightRow 与裸跑实现字节级一致。
 */
export class ExportService {
  constructor(private readonly db: AppDatabase) {}

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

    // 批量取帖子与评论，消除按洞察逐条 findUnique/findMany 的 N+1（1+2N → 3 条查询）。
    // 帖子按洞察顺序排列、跳过已归档缺失者；评论按 (created_utc,id) 升序后按帖分组，
    // 产出顺序与原逐条实现字节级一致（mobile ATTACH 合并依赖此格式）。
    const postIds = insightRows.map((ins) => ins.post_id);
    const postPgs = postIds.length
      ? await this.db.posts.findMany({ where: { id: { in: postIds } } })
      : [];
    const postPgById = new Map(postPgs.map((p) => [p.id, p]));
    const orderedPosts = postIds
      .map((id) => postPgById.get(id))
      .filter((p): p is PostPg => p != null);

    const presentPostIds = orderedPosts.map((p) => p.id);
    const commentPgs = presentPostIds.length
      ? await this.db.comments.findMany({
          where: { post_id: { in: presentPostIds } },
          orderBy: [{ created_utc: 'asc' }, { id: 'asc' }],
        })
      : [];
    const commentsByPost = new Map<string, CommentPg[]>();
    for (const c of commentPgs) {
      const arr = commentsByPost.get(c.post_id);
      if (arr) arr.push(c);
      else commentsByPost.set(c.post_id, [c]);
    }

    const postRows: PostRow[] = [];
    const commentRows: CommentRow[] = [];
    for (const p of orderedPosts) {
      postRows.push(toPostRow(p));
      const cs = commentsByPost.get(p.id);
      if (cs) for (const c of cs) commentRows.push(toCommentRow(c));
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
