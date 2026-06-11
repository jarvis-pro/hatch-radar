import type { InsightResult, Intensity, Opportunity, PainPoint } from '../analyzer/prompt.js';
import type { RedditComment, RedditPost } from '../crawler/reddit.js';
import { getDb } from './schema.js';

export interface PostRow {
  id: string;
  subreddit: string;
  title: string;
  author: string | null;
  selftext: string;
  url: string | null;
  permalink: string | null;
  score: number;
  num_comments: number;
  created_utc: number;
  fetched_at: number;
  comment_pass: number;
  comments_fetched_at: number | null;
  analyzed_at: number | null;
  analyze_attempts: number;
}

export interface CommentRow {
  id: string;
  post_id: string;
  parent_id: string | null;
  author: string | null;
  body: string;
  score: number;
  depth: number;
  created_utc: number;
  fetched_at: number;
}

interface InsightRow {
  id: number;
  post_id: string;
  subreddit: string;
  post_title: string;
  permalink: string | null;
  model: string;
  intensity: Intensity;
  pain_points: string;
  opportunities: string;
  tags: string;
  created_at: number;
}

export interface Insight {
  id: number;
  postId: string;
  subreddit: string;
  postTitle: string;
  permalink: string | null;
  model: string;
  intensity: Intensity;
  painPoints: PainPoint[];
  opportunities: Opportunity[];
  tags: string[];
  createdAt: number;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 写入/更新帖子；已存在时仅刷新分数、评论数等动态字段 */
export function upsertPosts(
  posts: RedditPost[],
  fetchedAt: number,
): { added: number; updated: number } {
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM posts WHERE id = ?`);
  const insert = db.prepare(`
    INSERT INTO posts (id, subreddit, title, author, selftext, url, permalink, score, num_comments, created_utc, fetched_at)
    VALUES (@id, @subreddit, @title, @author, @selftext, @url, @permalink, @score, @numComments, @createdUtc, @fetchedAt)
    ON CONFLICT(id) DO UPDATE SET
      title        = excluded.title,
      selftext     = excluded.selftext,
      score        = excluded.score,
      num_comments = excluded.num_comments,
      fetched_at   = excluded.fetched_at
  `);
  let added = 0;
  let updated = 0;
  db.transaction(() => {
    for (const p of posts) {
      if (exists.get(p.id)) updated++;
      else added++;
      insert.run({
        id: p.id,
        subreddit: p.subreddit,
        title: p.title,
        author: p.author,
        selftext: p.selftext,
        url: p.url,
        permalink: p.permalink,
        score: p.score,
        numComments: p.numComments,
        createdUtc: p.createdUtc,
        fetchedAt,
      });
    }
  })();
  return { added, updated };
}

export interface DuePost {
  post: PostRow;
  pass: 1 | 2;
}

/** 取出到达 6h / 12h 评论回捞窗口的帖子 */
export function getPostsDueForComments(now: number, limit: number): DuePost[] {
  const t6 = now - 6 * 3600;
  const t12 = now - 12 * 3600;
  const rows = getDb()
    .prepare(
      `SELECT * FROM posts
       WHERE (comment_pass < 1 AND created_utc <= ?)
          OR (comment_pass < 2 AND created_utc <= ?)
       ORDER BY created_utc DESC
       LIMIT ?`,
    )
    .all(t6, t12, limit) as PostRow[];
  return rows.map((post) => ({ post, pass: post.created_utc <= t12 ? 2 : 1 }));
}

/** 整体替换帖子的评论快照，并推进评论回捞阶段 */
export function replaceComments(
  postId: string,
  comments: RedditComment[],
  pass: number,
  fetchedAt: number,
): void {
  const db = getDb();
  const del = db.prepare(`DELETE FROM comments WHERE post_id = ?`);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO comments (id, post_id, parent_id, author, body, score, depth, created_utc, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const bump = db.prepare(`
    UPDATE posts
    SET comment_pass = MAX(comment_pass, ?), comments_fetched_at = ?
    WHERE id = ?
  `);
  db.transaction(() => {
    del.run(postId);
    for (const c of comments) {
      insert.run(
        c.id,
        postId,
        c.parentId,
        c.author,
        c.body,
        c.score,
        c.depth,
        c.createdUtc,
        fetchedAt,
      );
    }
    bump.run(pass, fetchedAt, postId);
  })();
}

/** 待分析帖子：已完成至少一轮评论回捞、未分析、失败少于 3 次，按热度排序 */
export function getPostsToAnalyze(limit: number): PostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM posts
       WHERE analyzed_at IS NULL AND comment_pass >= 1 AND analyze_attempts < 3
       ORDER BY (score + num_comments) DESC
       LIMIT ?`,
    )
    .all(limit) as PostRow[];
}

export function getCommentsForPost(postId: string): CommentRow[] {
  return getDb()
    .prepare(`SELECT * FROM comments WHERE post_id = ? ORDER BY depth ASC, score DESC`)
    .all(postId) as CommentRow[];
}

export function markAnalyzed(postId: string, analyzedAt: number): void {
  getDb().prepare(`UPDATE posts SET analyzed_at = ? WHERE id = ?`).run(analyzedAt, postId);
}

export function bumpAnalyzeAttempts(postId: string): void {
  getDb()
    .prepare(`UPDATE posts SET analyze_attempts = analyze_attempts + 1 WHERE id = ?`)
    .run(postId);
}

export function saveInsight(
  post: PostRow,
  model: string,
  insight: InsightResult,
  createdAt: number,
): void {
  const rank: Record<Intensity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  let intensity: Intensity = 'LOW';
  for (const p of insight.pain_points) {
    if (rank[p.intensity] > rank[intensity]) intensity = p.intensity;
  }
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO insights
         (post_id, subreddit, post_title, permalink, model, intensity, pain_points, opportunities, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      post.id,
      post.subreddit,
      post.title,
      post.permalink,
      model,
      intensity,
      JSON.stringify(insight.pain_points),
      JSON.stringify(insight.opportunities),
      JSON.stringify(insight.tags),
      createdAt,
    );
}

/** 清理 30 天前原始数据（帖子 + 评论），洞察结果永久保留 */
export function archiveOldData(cutoff: number): { posts: number; comments: number } {
  const db = getDb();
  let comments = 0;
  let posts = 0;
  db.transaction(() => {
    comments = db
      .prepare(`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE created_utc < ?)`)
      .run(cutoff).changes;
    posts = db.prepare(`DELETE FROM posts WHERE created_utc < ?`).run(cutoff).changes;
  })();
  return { posts, comments };
}

export interface InsightFilter {
  subreddit?: string;
  tag?: string;
  intensity?: string;
  limit?: number;
}

/** 按版块 / 标签 / 强度过滤检索洞察 */
export function searchInsights(filter: InsightFilter): Insight[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.subreddit) {
    clauses.push(`subreddit = ? COLLATE NOCASE`);
    params.push(filter.subreddit);
  }
  if (filter.intensity) {
    clauses.push(`intensity = ?`);
    params.push(filter.intensity.toUpperCase());
  }
  if (filter.tag) {
    clauses.push(`EXISTS (SELECT 1 FROM json_each(insights.tags) WHERE json_each.value LIKE ?)`);
    params.push(`%${filter.tag}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM insights ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, filter.limit ?? 20) as InsightRow[];
  return rows.map((row) => ({
    id: row.id,
    postId: row.post_id,
    subreddit: row.subreddit,
    postTitle: row.post_title,
    permalink: row.permalink,
    model: row.model,
    intensity: row.intensity,
    painPoints: JSON.parse(row.pain_points) as PainPoint[],
    opportunities: JSON.parse(row.opportunities) as Opportunity[],
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
  }));
}

export function getStats(): {
  posts: number;
  comments: number;
  pendingAnalysis: number;
  insights: number;
} {
  const db = getDb();
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
