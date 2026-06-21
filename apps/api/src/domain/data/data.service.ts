import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  Prisma,
  toCommentRow,
  toInsight,
  toPostRow,
  toTriage,
  type AppDatabase,
  type InsightPgRow,
} from '@/lib/db';
import {
  PAGE_SIZE,
  type CommentRow,
  type FilterOptions,
  type Insight,
  type Intensity,
  type Paged,
  type PostRow,
  type Triage,
} from '@hatch-radar/shared';

/** 洞察列表筛选条件 */
export interface InsightListFilter {
  source?: string;
  subreddit?: string;
  intensity?: Intensity;
  /** 关键词，匹配标题 / 标签 / 痛点 / 机会全文 */
  q?: string;
  page: number;
}

/** 帖子列表筛选条件 */
export interface PostListFilter {
  source?: string;
  subreddit?: string;
  /** analyzed=已产出洞察 pending=待分析 */
  status?: 'analyzed' | 'pending';
  /** 关键词，匹配标题 / 正文 */
  q?: string;
  page: number;
}

function clampPage(total: number, page: number): { page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { page: Math.min(Math.max(1, page), pageCount), pageCount };
}

/** 大小写不敏感排序（替代 SQLite 的 COLLATE NOCASE） */
function sortCI(values: string[]): string[] {
  return [...values].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/**
 * 只读数据服务（后端归一：原 web lib/queries.ts 整体迁来，行为不变）。
 * 浏览洞察 / 帖子 / 评论 / 研判 / 筛选项；写操作不在此（爬取与分析在各自模块）。
 */
@Injectable()
export class DataService {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /** 按条件分页检索洞察，按生成时间倒序（含 jsonb 全文 ILIKE → $queryRaw） */
  async listInsights(filter: InsightListFilter): Promise<Paged<Insight>> {
    const conds: Prisma.Sql[] = [];
    if (filter.source) conds.push(Prisma.sql`source = ${filter.source}`);
    if (filter.subreddit) conds.push(Prisma.sql`lower(subreddit) = lower(${filter.subreddit})`);
    if (filter.intensity) conds.push(Prisma.sql`intensity::text = ${filter.intensity}`);
    if (filter.q) {
      const like = `%${filter.q}%`;
      conds.push(
        Prisma.sql`(post_title ILIKE ${like} OR tags::text ILIKE ${like} OR pain_points::text ILIKE ${like} OR opportunities::text ILIKE ${like})`,
      );
    }
    const where =
      conds.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    const totalRows = await this.db.$queryRaw<
      [{ n: number }]
    >`SELECT count(*)::int AS n FROM insights ${where}`;
    const total = totalRows[0].n;
    const { page, pageCount } = clampPage(total, filter.page);
    const rows = await this.db.$queryRaw<InsightPgRow[]>`
      SELECT * FROM insights ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `;
    return { items: rows.map(toInsight), total, page, pageCount };
  }

  /** 按 id 取单条洞察 */
  async getInsight(id: number): Promise<Insight | null> {
    const row = await this.db.insights.findUnique({ where: { id } });
    return row ? toInsight(row) : null;
  }

  /** 取洞察的人工研判结果（移动端同步回传）；无则返回 null */
  async getTriageForInsight(insightId: number): Promise<Triage | null> {
    const row = await this.db.triage.findUnique({ where: { insight_id: insightId } });
    return row ? toTriage(row) : null;
  }

  /** 取帖子对应的洞察（帖子详情页交叉跳转用） */
  async getInsightForPost(postId: string): Promise<Insight | null> {
    const row = await this.db.insights.findUnique({ where: { post_id: postId } });
    return row ? toInsight(row) : null;
  }

  /** 洞察详情：洞察 + 研判 + 来源帖（帖子归档后为 null，洞察仍可见）。不存在返回 null。 */
  async getInsightDetail(
    id: number,
  ): Promise<{ insight: Insight; triage: Triage | null; post: PostRow | null } | null> {
    const insight = await this.getInsight(id);
    if (!insight) return null;
    const [triage, post] = await Promise.all([
      this.getTriageForInsight(id),
      this.getPost(insight.postId),
    ]);
    return { insight, triage, post };
  }

  /** 按条件分页检索帖子，按发帖时间倒序 */
  async listPosts(filter: PostListFilter): Promise<Paged<PostRow>> {
    const where: Prisma.postsWhereInput = {};
    if (filter.source) where.source = filter.source;
    if (filter.subreddit) where.subreddit = { equals: filter.subreddit, mode: 'insensitive' };
    if (filter.status === 'analyzed') where.analyzed_at = { not: null };
    if (filter.status === 'pending') where.analyzed_at = null;
    if (filter.q) {
      where.OR = [
        { title: { contains: filter.q, mode: 'insensitive' } },
        { selftext: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    const total = await this.db.posts.count({ where });
    const { page, pageCount } = clampPage(total, filter.page);
    const rows = await this.db.posts.findMany({
      where,
      orderBy: [{ created_utc: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    return { items: rows.map(toPostRow), total, page, pageCount };
  }

  /** 按 id 取单篇帖子（30 天归档后返回 null，洞察仍可见） */
  async getPost(id: string): Promise<PostRow | null> {
    const row = await this.db.posts.findUnique({ where: { id } });
    return row ? toPostRow(row) : null;
  }

  /** 取帖子全部评论，按发表时间升序（树结构由展示层组装） */
  async getComments(postId: string): Promise<CommentRow[]> {
    const rows = await this.db.comments.findMany({
      where: { post_id: postId },
      orderBy: [{ created_utc: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCommentRow);
  }

  /** 洞察页筛选项：取自 insights 表（帖子归档后洞察仍在） */
  async insightFilterOptions(): Promise<FilterOptions> {
    const [sources, subreddits] = await Promise.all([
      this.db.insights.findMany({ distinct: ['source'], select: { source: true } }),
      this.db.insights.findMany({ distinct: ['subreddit'], select: { subreddit: true } }),
    ]);
    return {
      sources: sources.map((r) => r.source).sort(),
      subreddits: sortCI(subreddits.map((r) => r.subreddit)),
    };
  }

  /** 帖子页筛选项：取自 posts 表 */
  async postFilterOptions(): Promise<FilterOptions> {
    const [sources, subreddits] = await Promise.all([
      this.db.posts.findMany({ distinct: ['source'], select: { source: true } }),
      this.db.posts.findMany({ distinct: ['subreddit'], select: { subreddit: true } }),
    ]);
    return {
      sources: sources.map((r) => r.source).sort(),
      subreddits: sortCI(subreddits.map((r) => r.subreddit)),
    };
  }
}
