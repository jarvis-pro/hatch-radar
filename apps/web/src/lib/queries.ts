import {
  Prisma,
  toCommentRow,
  toInsight,
  toPostRow,
  toTriage,
  type AppDatabase,
  type InsightPgRow,
  type PostPg,
} from '@hatch-radar/db';
import type { CommentRow, Insight, Intensity, PostRow, Triage } from '@hatch-radar/shared';

type Db = AppDatabase;

/** 列表页统一分页大小 */
export const PAGE_SIZE = 20;

/** 分页查询结果 */
export interface Paged<T> {
  items: T[];
  /** 满足筛选条件的总条数 */
  total: number;
  /** 实际生效的页码（越界时收敛到合法区间） */
  page: number;
  pageCount: number;
}

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

/** 按条件分页检索洞察，按生成时间倒序（含 jsonb 全文 ILIKE → $queryRaw） */
export async function listInsights(db: Db, filter: InsightListFilter): Promise<Paged<Insight>> {
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
  const where = conds.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
  const totalRows = await db.$queryRaw<
    [{ n: number }]
  >`SELECT count(*)::int AS n FROM insights ${where}`;
  const total = totalRows[0].n;
  const { page, pageCount } = clampPage(total, filter.page);
  const rows = await db.$queryRaw<InsightPgRow[]>`
    SELECT * FROM insights ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
  `;
  return { items: rows.map(toInsight), total, page, pageCount };
}

/** 按 id 取单条洞察 */
export async function getInsight(db: Db, id: number): Promise<Insight | null> {
  const row = await db.insights.findUnique({ where: { id } });
  return row ? toInsight(row) : null;
}

/** 取洞察的人工研判结果（移动端同步回传）；无则返回 null */
export async function getTriageForInsight(db: Db, insightId: number): Promise<Triage | null> {
  const row = await db.triage.findUnique({ where: { insight_id: insightId } });
  return row ? toTriage(row) : null;
}

/** 取帖子对应的洞察（帖子详情页交叉跳转用） */
export async function getInsightForPost(db: Db, postId: string): Promise<Insight | null> {
  const row = await db.insights.findUnique({ where: { post_id: postId } });
  return row ? toInsight(row) : null;
}

/** 按条件分页检索帖子，按发帖时间倒序 */
export async function listPosts(db: Db, filter: PostListFilter): Promise<Paged<PostRow>> {
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
  const total = await db.posts.count({ where });
  const { page, pageCount } = clampPage(total, filter.page);
  const rows = await db.posts.findMany({
    where,
    orderBy: [{ created_utc: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return { items: rows.map(toPostRow), total, page, pageCount };
}

/** 工作台「待分析」帖子的状态：pending=未分析；restale=已分析但之后评论又变（建议重判） */
export type AwaitingKind = 'pending' | 'restale';

/** 待分析帖子行：帖子字段 + 工作台状态（kind） */
export interface AwaitingPost extends PostRow {
  kind: AwaitingKind;
}

/**
 * 工作台「待分析」列表：已抓过评论（comments_fetched_at 非空）、
 * 且 未产出洞察（pending）或 已分析但评论在分析后又变（restale，comments_changed_at > insight.created_at）。
 * pending 排在前，再按热度（score + 评论数）降序分页。JOIN + CASE + 算术排序 → $queryRaw。
 */
export async function listAwaitingManualResult(db: Db, page: number): Promise<Paged<AwaitingPost>> {
  const where = Prisma.sql`p.comments_fetched_at IS NOT NULL AND (i.post_id IS NULL OR p.comments_changed_at > i.created_at)`;
  const totalRows = await db.$queryRaw<[{ n: number }]>`
    SELECT count(*)::int AS n FROM posts p LEFT JOIN insights i ON i.post_id = p.id WHERE ${where}
  `;
  const total = totalRows[0].n;
  const { page: pageNum, pageCount } = clampPage(total, page);
  const rows = await db.$queryRaw<Array<PostPg & { kind: AwaitingKind }>>`
    SELECT p.*, CASE WHEN i.post_id IS NULL THEN 'pending' ELSE 'restale' END AS kind
    FROM posts p
    LEFT JOIN insights i ON i.post_id = p.id
    WHERE ${where}
    ORDER BY (i.post_id IS NULL) DESC, (p.score + p.num_comments) DESC, p.id ASC
    LIMIT ${PAGE_SIZE} OFFSET ${(pageNum - 1) * PAGE_SIZE}
  `;
  return {
    items: rows.map((r) => ({ ...toPostRow(r), kind: r.kind })),
    total,
    page: pageNum,
    pageCount,
  };
}

/** 按 id 取单篇帖子（30 天归档后返回 null，洞察仍可见） */
export async function getPost(db: Db, id: string): Promise<PostRow | null> {
  const row = await db.posts.findUnique({ where: { id } });
  return row ? toPostRow(row) : null;
}

/** 取帖子全部评论，按发表时间升序（树结构由展示层组装） */
export async function getComments(db: Db, postId: string): Promise<CommentRow[]> {
  const rows = await db.comments.findMany({
    where: { post_id: postId },
    orderBy: [{ created_utc: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toCommentRow);
}

/** 概览计数（与 server 启动日志同口径） */
export async function getStats(db: Db): Promise<{
  posts: number;
  comments: number;
  pendingAnalysis: number;
  insights: number;
}> {
  const [posts, comments, pendingAnalysis, insights] = await Promise.all([
    db.posts.count(),
    db.comments.count(),
    db.posts.count({
      where: { analyzed_at: null, comment_pass: { gte: 1 }, analyze_attempts: { lt: 3 } },
    }),
    db.insights.count(),
  ]);
  return { posts, comments, pendingAnalysis, insights };
}

/** 筛选下拉可选项（来源 / 版块去重清单） */
export interface FilterOptions {
  sources: string[];
  subreddits: string[];
}

/** 大小写不敏感排序（替代 SQLite 的 COLLATE NOCASE） */
function sortCI(values: string[]): string[] {
  return [...values].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** 洞察页筛选项：取自 insights 表（帖子归档后洞察仍在） */
export async function insightFilterOptions(db: Db): Promise<FilterOptions> {
  const [sources, subreddits] = await Promise.all([
    db.insights.findMany({ distinct: ['source'], select: { source: true } }),
    db.insights.findMany({ distinct: ['subreddit'], select: { subreddit: true } }),
  ]);
  return {
    sources: sources.map((r) => r.source).sort(),
    subreddits: sortCI(subreddits.map((r) => r.subreddit)),
  };
}

/** 帖子页筛选项：取自 posts 表 */
export async function postFilterOptions(db: Db): Promise<FilterOptions> {
  const [sources, subreddits] = await Promise.all([
    db.posts.findMany({ distinct: ['source'], select: { source: true } }),
    db.posts.findMany({ distinct: ['subreddit'], select: { subreddit: true } }),
  ]);
  return {
    sources: sources.map((r) => r.source).sort(),
    subreddits: sortCI(subreddits.map((r) => r.subreddit)),
  };
}
