import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  Prisma,
  toCommentRow,
  toInsightRow,
  toPostRow,
  type AppDatabase,
  type CommentPg,
  type InsightPgRow,
  type PostPg,
} from '@/database';
import {
  EXPORT_FORMAT_VERSION,
  type CommentRow,
  type ExportBatch,
  type ExportFilter,
  type ExportTranslation,
  type PostRow,
} from '@hatch-radar/shared';
import { nowSec } from '@/utils/time';

/**
 * 导出批次收集（数据源 = PG）。
 *
 * 「有效数据」基线：洞察必须有实质信号（痛点或机会非空），在此之上叠加可选筛选。
 * 关联帖子已被 30 天归档清理时仅导出洞察本身（post_id 为软引用，移动端按缺失处理）。
 * jsonb 字段经 toInsightRow stringify 回 TEXT，产出的 InsightRow 与裸跑实现字节级一致。
 */
@Injectable()
export class ExportService {
  constructor(
    // 事务感知数据库代理：直查 insights / posts / comments / translations 组装批次
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /**
   * 构造「有效洞察」筛选条件（针对 insights 表）：实质信号基线 + 可选 since/强度/版块。
   * collectBatch 与 selectPostIds 共用，确保导出与「批量补翻覆盖率」对同一批数据。
   * @param filter 批次筛选条件
   */
  private insightConds(filter: ExportFilter): Prisma.Sql[] {
    const conds: Prisma.Sql[] = [
      Prisma.sql`(jsonb_array_length(pain_points) > 0 OR jsonb_array_length(opportunities) > 0)`,
    ];
    if (filter.since) {
      conds.push(Prisma.sql`created_at > ${BigInt(filter.since)}`);
    }

    if (filter.minIntensity === 'HIGH') {
      conds.push(Prisma.sql`intensity::text = 'HIGH'`);
    }

    if (filter.minIntensity === 'MEDIUM') {
      conds.push(Prisma.sql`intensity::text IN ('HIGH', 'MEDIUM')`);
    }

    if (filter.subreddit) {
      conds.push(Prisma.sql`lower(subreddit) = lower(${filter.subreddit})`);
    }

    return conds;
  }

  /**
   * 仅取一个导出筛选命中的、当前仍存在（未归档）的帖子 ID（按导出同序）。
   * 供翻译覆盖率统计与批量补翻——与 collectBatch 选取的帖子完全一致。
   * @param filter 批次筛选条件
   * @returns 命中且未归档的 post_id 列表，按导出同序（created_at DESC, id DESC）；无命中或全部已归档时为空数组
   */
  async selectPostIds(filter: ExportFilter): Promise<string[]> {
    const where = Prisma.join(this.insightConds(filter), ' AND ');
    const limit = filter.limit ? Prisma.sql`LIMIT ${filter.limit}` : Prisma.empty;
    const rows = await this.db.$queryRaw<{ post_id: string }[]>`
      SELECT post_id FROM insights
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      ${limit}
    `;
    const ids = rows.map((r) => r.post_id);
    if (ids.length === 0) {
      return [];
    }

    // 过滤到现存帖（30 天归档后仅余洞察、无可译原文）；保留导出顺序
    const present = await this.db.posts.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const presentSet = new Set(present.map((p) => p.id));

    return ids.filter((id) => presentSet.has(id));
  }

  /**
   * 按条件从主库组装一个完整导出批次（洞察 + 关联帖子 / 评论 + 已完成中文译文）。
   * - 已归档（缺失）的关联帖子被跳过，仅其洞察保留（post_id 为软引用）
   * - 帖子按洞察顺序、评论按 (created_utc,id) 升序分组，产出与逐条实现字节级一致（移动端 ATTACH 合并依赖此格式）
   * - 译文按实体（帖子标题 / 正文、评论正文）展开，移动端以 post.id / comment.id 直接贴中文
   * @param filter 批次筛选条件
   * @returns 含 meta（格式版本、导出时间、各类计数）与 insights/posts/comments/translations 四组数据的批次
   */
  async collectBatch(filter: ExportFilter): Promise<ExportBatch> {
    const where = Prisma.join(this.insightConds(filter), ' AND ');
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
      if (arr) {
        arr.push(c);
      } else {
        commentsByPost.set(c.post_id, [c]);
      }
    }

    const postRows: PostRow[] = [];
    const commentRows: CommentRow[] = [];
    for (const p of orderedPosts) {
      postRows.push(toPostRow(p));
      const cs = commentsByPost.get(p.id);
      if (cs) {
        for (const c of cs) {
          commentRows.push(toCommentRow(c));
        }
      }
    }

    // 本批帖子/评论涉及的内容哈希 → 取已完成译文（按 content_hash），随导出带给移动端做中文优先渲染。
    const hashes = [
      ...new Set(
        [
          ...postRows.flatMap((p) => [p.title_hash, p.selftext_hash]),
          ...commentRows.map((c) => c.body_hash),
        ].filter((h): h is string => h != null),
      ),
    ];
    const doneRows = hashes.length
      ? await this.db.$queryRaw<{ content_hash: string; text: string }[]>`
          SELECT content_hash, text FROM translations
          WHERE status = 'done' AND text IS NOT NULL AND content_hash IN (${Prisma.join(hashes)})
        `
      : [];
    const zhByHash = new Map(doneRows.map((r) => [r.content_hash, r.text]));
    // 按实体（帖子标题/正文、评论正文）展开：移动端用 post.id / comment.id 直接贴中文，无需重算哈希
    const translations: ExportTranslation[] = [];
    for (const p of postRows) {
      const tZh = p.title_hash ? zhByHash.get(p.title_hash) : undefined;
      if (tZh != null) {
        translations.push({ entity_kind: 'post_title', entity_id: p.id, text: tZh });
      }

      const sZh = p.selftext_hash ? zhByHash.get(p.selftext_hash) : undefined;
      if (sZh != null) {
        translations.push({ entity_kind: 'post_selftext', entity_id: p.id, text: sZh });
      }
    }

    for (const c of commentRows) {
      const bZh = c.body_hash ? zhByHash.get(c.body_hash) : undefined;
      if (bZh != null) {
        translations.push({ entity_kind: 'comment_body', entity_id: c.id, text: bZh });
      }
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
          translations: translations.length,
        },
      },
      insights: insightRows.map(toInsightRow),
      posts: postRows,
      comments: commentRows,
      translations,
    };
  }
}
