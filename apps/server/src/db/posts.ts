import type { PostRow } from '@hatch-radar/shared';
import type { RedditPost } from '../crawler/reddit';
import { getDb } from './schema';

/**
 * 写入帖子列表，已存在的帖子仅刷新动态字段（分数、评论数、标题、正文、抓取时间）。
 * - source 与 subreddit 字段在冲突更新时不会变更
 * @param posts 待写入的帖子列表
 * @param source 数据来源标识，如 `'reddit'` / `'hackernews'` / `'rss'`
 * @param fetchedAt 本次抓取 Unix 时间戳（秒）
 * @param initialCommentPass 新帖的初始回捞阶段；RSS 等无评论来源传 2 跳过回捞，默认 0
 * @returns 本批次新增数、更新数，以及新增帖子的 `{ id, subreddit }`（供 scan 触发即时抓评论）
 */
export function upsertPosts(
  posts: RedditPost[],
  source: string,
  fetchedAt: number,
  initialCommentPass = 0,
): { added: number; updated: number; newPosts: { id: string; subreddit: string }[] } {
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM posts WHERE id = ?`);
  const insert = db.prepare(`
    INSERT INTO posts (id, source, subreddit, title, author, selftext, url, permalink, score, num_comments, created_utc, fetched_at, comment_pass)
    VALUES (@id, @source, @subreddit, @title, @author, @selftext, @url, @permalink, @score, @numComments, @createdUtc, @fetchedAt, @commentPass)
    ON CONFLICT(id) DO UPDATE SET
      title        = excluded.title,
      selftext     = excluded.selftext,
      score        = excluded.score,
      num_comments = excluded.num_comments,
      fetched_at   = excluded.fetched_at
  `);
  let added = 0;
  let updated = 0;
  const newPosts: { id: string; subreddit: string }[] = [];
  db.transaction(() => {
    for (const p of posts) {
      if (exists.get(p.id)) {
        updated++;
      } else {
        added++;
        newPosts.push({ id: p.id, subreddit: p.subreddit });
      }
      insert.run({
        id: p.id,
        source,
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
        commentPass: initialCommentPass,
      });
    }
  })();
  return { added, updated, newPosts };
}

/** 评论 refresh 节奏与冻结策略（秒） */
const REFRESH = {
  /** 发帖 24h 内视为活跃热帖，按 youngInterval 频繁回捞 */
  youngAge: 24 * 3600,
  youngInterval: 25 * 60,
  /** 7 天以上不再 refresh（但从未抓过的仍会被抓一次） */
  maxAge: 7 * 86400,
  midInterval: 24 * 3600,
};

/**
 * 取需要（重新）抓取评论的帖子：从未抓过的优先，其余按帖龄衰减的节奏 refresh。
 * - 排除 RSS（无评论）
 * - <24h 热帖每轮回捞、24h–7d 帖每日回捞、>7d 不再 refresh
 * @param now 当前 Unix 时间戳（秒）
 * @param limit 最多返回条数
 * @returns 待抓/待刷新的帖子，从未抓过的排在前
 */
export function getPostsNeedingCommentRefresh(now: number, limit: number): PostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM posts
       WHERE source != 'rss'
         AND (
           comments_fetched_at IS NULL
           OR (created_utc > ? AND comments_fetched_at < ?)
           OR (created_utc > ? AND comments_fetched_at < ?)
         )
       ORDER BY (comments_fetched_at IS NOT NULL), created_utc DESC
       LIMIT ?`,
    )
    .all(
      now - REFRESH.youngAge,
      now - REFRESH.youngInterval,
      now - REFRESH.maxAge,
      now - REFRESH.midInterval,
      limit,
    ) as PostRow[];
}

/**
 * 取出等待 AI 分析的帖子：已完成至少一轮评论回捞、尚未分析、失败次数不超过 2 次。
 * - 按 `(score + num_comments)` 降序排列，优先处理热度高的帖子
 * @param limit 最多返回条数
 */
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

/**
 * 按 ID 取单篇帖子。
 * - worker 分析落库时需要 source / subreddit / title / permalink 等字段
 * @param id 帖子 ID
 * @returns 帖子行；不存在（含 30 天归档后已删除）时返回 undefined
 */
export function getPostById(id: string): PostRow | undefined {
  return getDb().prepare(`SELECT * FROM posts WHERE id = ?`).get(id) as PostRow | undefined;
}

/**
 * 将帖子标记为已完成 AI 分析。
 * @param postId 目标帖子 ID
 * @param analyzedAt 分析完成 Unix 时间戳（秒）
 */
export function markAnalyzed(postId: string, analyzedAt: number): void {
  getDb().prepare(`UPDATE posts SET analyzed_at = ? WHERE id = ?`).run(analyzedAt, postId);
}

/**
 * 将帖子的分析尝试次数加一。
 * - 达到 3 次后 getPostsToAnalyze() 不再返回该帖子
 * @param postId 目标帖子 ID
 */
export function bumpAnalyzeAttempts(postId: string): void {
  getDb()
    .prepare(`UPDATE posts SET analyze_attempts = analyze_attempts + 1 WHERE id = ?`)
    .run(postId);
}

/**
 * 清理早于 cutoff 时间戳的帖子与关联评论，洞察结果永久保留。
 * - 先删评论再删帖子，返回实际删除条数
 * @param cutoff Unix 时间戳（秒），早于此时间的帖子将被删除
 * @returns 被删除的帖子数与评论数
 */
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
