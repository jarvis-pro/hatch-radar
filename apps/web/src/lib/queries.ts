import { and, asc, desc, eq, getTableColumns, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import {
  comments,
  insights,
  posts,
  toInsight,
  toTriage,
  triage,
  type AppDatabase,
} from '@hatch-radar/db';
import type { CommentRow, Insight, Intensity, PostRow, Triage } from '@hatch-radar/shared';

type Db = AppDatabase;

/** 列表页统一分页大小 */
export const PAGE_SIZE = 20;

/** count(*) 表达式（::int 收敛为 number，避免 bigint 字符串） */
const COUNT = sql<number>`count(*)::int`;

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

/** 按条件分页检索洞察，按生成时间倒序 */
export async function listInsights(db: Db, filter: InsightListFilter): Promise<Paged<Insight>> {
  const conds: SQL[] = [];
  if (filter.source) conds.push(eq(insights.source, filter.source));
  if (filter.subreddit) conds.push(sql`lower(${insights.subreddit}) = lower(${filter.subreddit})`);
  if (filter.intensity) conds.push(sql`${insights.intensity}::text = ${filter.intensity}`);
  if (filter.q) {
    const like = `%${filter.q}%`;
    conds.push(
      sql`(${insights.post_title} ILIKE ${like} OR ${insights.tags}::text ILIKE ${like} OR ${insights.pain_points}::text ILIKE ${like} OR ${insights.opportunities}::text ILIKE ${like})`,
    );
  }
  const where = conds.length > 0 ? and(...conds) : undefined;
  const total = (await db.select({ n: COUNT }).from(insights).where(where))[0].n;
  const { page, pageCount } = clampPage(total, filter.page);
  const rows = await db
    .select()
    .from(insights)
    .where(where)
    .orderBy(desc(insights.created_at), desc(insights.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return { items: rows.map(toInsight), total, page, pageCount };
}

/** 按 id 取单条洞察 */
export async function getInsight(db: Db, id: number): Promise<Insight | null> {
  const rows = await db.select().from(insights).where(eq(insights.id, id)).limit(1);
  return rows[0] ? toInsight(rows[0]) : null;
}

/** 取洞察的人工研判结果（移动端同步回传）；无则返回 null */
export async function getTriageForInsight(db: Db, insightId: number): Promise<Triage | null> {
  const rows = await db.select().from(triage).where(eq(triage.insight_id, insightId)).limit(1);
  return rows[0] ? toTriage(rows[0]) : null;
}

/** 取帖子对应的洞察（帖子详情页交叉跳转用） */
export async function getInsightForPost(db: Db, postId: string): Promise<Insight | null> {
  const rows = await db.select().from(insights).where(eq(insights.post_id, postId)).limit(1);
  return rows[0] ? toInsight(rows[0]) : null;
}

/** 按条件分页检索帖子，按发帖时间倒序 */
export async function listPosts(db: Db, filter: PostListFilter): Promise<Paged<PostRow>> {
  const conds: SQL[] = [];
  if (filter.source) conds.push(eq(posts.source, filter.source));
  if (filter.subreddit) conds.push(sql`lower(${posts.subreddit}) = lower(${filter.subreddit})`);
  if (filter.status === 'analyzed') conds.push(isNotNull(posts.analyzed_at));
  if (filter.status === 'pending') conds.push(isNull(posts.analyzed_at));
  if (filter.q) {
    const like = `%${filter.q}%`;
    conds.push(sql`(${posts.title} ILIKE ${like} OR ${posts.selftext} ILIKE ${like})`);
  }
  const where = conds.length > 0 ? and(...conds) : undefined;
  const total = (await db.select({ n: COUNT }).from(posts).where(where))[0].n;
  const { page, pageCount } = clampPage(total, filter.page);
  const items = await db
    .select()
    .from(posts)
    .where(where)
    .orderBy(desc(posts.created_utc), asc(posts.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return { items, total, page, pageCount };
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
 * pending 排在前，再按热度（score + 评论数）降序分页。
 */
export async function listAwaitingManualResult(db: Db, page: number): Promise<Paged<AwaitingPost>> {
  const where = sql`${posts.comments_fetched_at} IS NOT NULL AND (${insights.post_id} IS NULL OR ${posts.comments_changed_at} > ${insights.created_at})`;
  const total = (
    await db
      .select({ n: COUNT })
      .from(posts)
      .leftJoin(insights, eq(insights.post_id, posts.id))
      .where(where)
  )[0].n;
  const { page: pageNum, pageCount } = clampPage(total, page);
  const items = await db
    .select({
      ...getTableColumns(posts),
      kind: sql<AwaitingKind>`CASE WHEN ${insights.post_id} IS NULL THEN 'pending' ELSE 'restale' END`,
    })
    .from(posts)
    .leftJoin(insights, eq(insights.post_id, posts.id))
    .where(where)
    .orderBy(
      sql`(${insights.post_id} IS NULL) DESC`,
      sql`(${posts.score} + ${posts.num_comments}) DESC`,
      asc(posts.id),
    )
    .limit(PAGE_SIZE)
    .offset((pageNum - 1) * PAGE_SIZE);
  return { items, total, page: pageNum, pageCount };
}

/** 按 id 取单篇帖子（30 天归档后返回 null，洞察仍可见） */
export async function getPost(db: Db, id: string): Promise<PostRow | null> {
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 取帖子全部评论，按发表时间升序（树结构由展示层组装） */
export function getComments(db: Db, postId: string): Promise<CommentRow[]> {
  return db
    .select()
    .from(comments)
    .where(eq(comments.post_id, postId))
    .orderBy(asc(comments.created_utc), asc(comments.id));
}

/** 概览计数（与 server 启动日志同口径） */
export async function getStats(db: Db): Promise<{
  posts: number;
  comments: number;
  pendingAnalysis: number;
  insights: number;
}> {
  const [postsN, commentsN, pendingN, insightsN] = await Promise.all([
    db.select({ n: COUNT }).from(posts),
    db.select({ n: COUNT }).from(comments),
    db
      .select({ n: COUNT })
      .from(posts)
      .where(
        and(
          isNull(posts.analyzed_at),
          sql`${posts.comment_pass} >= 1`,
          sql`${posts.analyze_attempts} < 3`,
        ),
      ),
    db.select({ n: COUNT }).from(insights),
  ]);
  return {
    posts: postsN[0].n,
    comments: commentsN[0].n,
    pendingAnalysis: pendingN[0].n,
    insights: insightsN[0].n,
  };
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
    db.selectDistinct({ s: insights.source }).from(insights),
    db.selectDistinct({ s: insights.subreddit }).from(insights),
  ]);
  return {
    sources: sources.map((r) => r.s).sort(),
    subreddits: sortCI(subreddits.map((r) => r.s)),
  };
}

/** 帖子页筛选项：取自 posts 表 */
export async function postFilterOptions(db: Db): Promise<FilterOptions> {
  const [sources, subreddits] = await Promise.all([
    db.selectDistinct({ s: posts.source }).from(posts),
    db.selectDistinct({ s: posts.subreddit }).from(posts),
  ]);
  return {
    sources: sources.map((r) => r.s).sort(),
    subreddits: sortCI(subreddits.map((r) => r.s)),
  };
}
