import {
  rowToInsight,
  rowToTriage,
  type CommentRow,
  type Insight,
  type InsightRow,
  type Intensity,
  type PostRow,
  type Triage,
  type TriageRow,
} from '@hatch-radar/shared';
import type Database from 'better-sqlite3';

type Db = Database.Database;

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

/** 按条件分页检索洞察，按生成时间倒序 */
export function listInsights(db: Db, filter: InsightListFilter): Paged<Insight> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.source) {
    clauses.push('source = ?');
    params.push(filter.source);
  }
  if (filter.subreddit) {
    clauses.push('subreddit = ? COLLATE NOCASE');
    params.push(filter.subreddit);
  }
  if (filter.intensity) {
    clauses.push('intensity = ?');
    params.push(filter.intensity);
  }
  if (filter.q) {
    clauses.push(
      '(post_title LIKE ? OR tags LIKE ? OR pain_points LIKE ? OR opportunities LIKE ?)',
    );
    const like = `%${filter.q}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) n FROM insights ${where}`).get(...params) as { n: number }
  ).n;
  const { page, pageCount } = clampPage(total, filter.page);
  const rows = db
    .prepare(`SELECT * FROM insights ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE) as InsightRow[];
  return { items: rows.map(rowToInsight), total, page, pageCount };
}

/** 按 id 取单条洞察 */
export function getInsight(db: Db, id: number): Insight | null {
  const row = db.prepare(`SELECT * FROM insights WHERE id = ?`).get(id) as InsightRow | undefined;
  return row ? rowToInsight(row) : null;
}

/**
 * 取洞察的人工研判结果（移动端同步回传，里程碑 6 起存在）。
 * 旧库可能还没有 triage 表（server 升级后首次运行才建表），先探表再查。
 */
export function getTriageForInsight(db: Db, insightId: number): Triage | null {
  const hasTable = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'triage'`)
    .get();
  if (!hasTable) return null;
  const row = db.prepare(`SELECT * FROM triage WHERE insight_id = ?`).get(insightId) as
    | TriageRow
    | undefined;
  return row ? rowToTriage(row) : null;
}

/** 取帖子对应的洞察（帖子详情页交叉跳转用） */
export function getInsightForPost(db: Db, postId: string): Insight | null {
  const row = db.prepare(`SELECT * FROM insights WHERE post_id = ?`).get(postId) as
    | InsightRow
    | undefined;
  return row ? rowToInsight(row) : null;
}

/** 按条件分页检索帖子，按发帖时间倒序 */
export function listPosts(db: Db, filter: PostListFilter): Paged<PostRow> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.source) {
    clauses.push('source = ?');
    params.push(filter.source);
  }
  if (filter.subreddit) {
    clauses.push('subreddit = ? COLLATE NOCASE');
    params.push(filter.subreddit);
  }
  if (filter.status === 'analyzed') clauses.push('analyzed_at IS NOT NULL');
  if (filter.status === 'pending') clauses.push('analyzed_at IS NULL');
  if (filter.q) {
    clauses.push('(title LIKE ? OR selftext LIKE ?)');
    const like = `%${filter.q}%`;
    params.push(like, like);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) n FROM posts ${where}`).get(...params) as { n: number }
  ).n;
  const { page, pageCount } = clampPage(total, filter.page);
  const items = db
    .prepare(`SELECT * FROM posts ${where} ORDER BY created_utc DESC, id LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE) as PostRow[];
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
export function listAwaitingManualResult(db: Db, page: number): Paged<AwaitingPost> {
  const where = `WHERE p.comments_fetched_at IS NOT NULL
      AND (i.post_id IS NULL OR p.comments_changed_at > i.created_at)`;
  const total = (
    db
      .prepare(`SELECT COUNT(*) n FROM posts p LEFT JOIN insights i ON i.post_id = p.id ${where}`)
      .get() as { n: number }
  ).n;
  const { page: pageNum, pageCount } = clampPage(total, page);
  const items = db
    .prepare(
      `SELECT p.*, CASE WHEN i.post_id IS NULL THEN 'pending' ELSE 'restale' END AS kind
       FROM posts p LEFT JOIN insights i ON i.post_id = p.id
       ${where}
       ORDER BY (i.post_id IS NULL) DESC, (p.score + p.num_comments) DESC, p.id
       LIMIT ? OFFSET ?`,
    )
    .all(PAGE_SIZE, (pageNum - 1) * PAGE_SIZE) as AwaitingPost[];
  return { items, total, page: pageNum, pageCount };
}

/** 按 id 取单篇帖子（30 天归档后返回 null，洞察仍可见） */
export function getPost(db: Db, id: string): PostRow | null {
  const row = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id) as PostRow | undefined;
  return row ?? null;
}

/** 取帖子全部评论，按发表时间升序（树结构由展示层组装） */
export function getComments(db: Db, postId: string): CommentRow[] {
  return db
    .prepare(`SELECT * FROM comments WHERE post_id = ? ORDER BY created_utc ASC, id`)
    .all(postId) as CommentRow[];
}

/** 概览计数（与 server 启动日志同口径） */
export function getStats(db: Db): {
  posts: number;
  comments: number;
  pendingAnalysis: number;
  insights: number;
} {
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    posts: count(`SELECT COUNT(*) n FROM posts`),
    comments: count(`SELECT COUNT(*) n FROM comments`),
    pendingAnalysis: count(
      `SELECT COUNT(*) n FROM posts WHERE analyzed_at IS NULL AND comment_pass >= 1 AND analyze_attempts < 3`,
    ),
    insights: count(`SELECT COUNT(*) n FROM insights`),
  };
}

/** 筛选下拉可选项（来源 / 版块去重清单） */
export interface FilterOptions {
  sources: string[];
  subreddits: string[];
}

/** 洞察页筛选项：取自 insights 表（帖子归档后洞察仍在） */
export function insightFilterOptions(db: Db): FilterOptions {
  return {
    sources: (
      db.prepare(`SELECT DISTINCT source s FROM insights ORDER BY s`).all() as { s: string }[]
    ).map((r) => r.s),
    subreddits: (
      db.prepare(`SELECT DISTINCT subreddit s FROM insights ORDER BY s COLLATE NOCASE`).all() as {
        s: string;
      }[]
    ).map((r) => r.s),
  };
}

/** 帖子页筛选项：取自 posts 表 */
export function postFilterOptions(db: Db): FilterOptions {
  return {
    sources: (
      db.prepare(`SELECT DISTINCT source s FROM posts ORDER BY s`).all() as { s: string }[]
    ).map((r) => r.s),
    subreddits: (
      db.prepare(`SELECT DISTINCT subreddit s FROM posts ORDER BY s COLLATE NOCASE`).all() as {
        s: string;
      }[]
    ).map((r) => r.s),
  };
}
