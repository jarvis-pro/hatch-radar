import type { RedditPost } from '../crawler/reddit.js';
import { getDb } from './schema.js';

/** posts 表的行结构 */
export interface PostRow {
  /** 帖子唯一 ID；Reddit 为 base36，HN 格式 `hn_{id}`，RSS 格式 `rss_{sha1前16位}` */
  id: string;
  /** 数据来源标识：`'reddit'` | `'hackernews'` | `'rss'` */
  source: string;
  /** 版块/频道名称；Reddit 为版块名（不含 r/），其他源为自定义频道标识 */
  subreddit: string;
  title: string;
  /** 发帖人用户名；账号已删除时为 null */
  author: string | null;
  /** 正文内容；外链帖或无正文时为空字符串 */
  selftext: string;
  /** 外链或来源 URL；自发帖可能为 null */
  url: string | null;
  /** 固定链接；Reddit 为相对路径，HN/RSS 为完整 URL */
  permalink: string | null;
  score: number;
  /** 评论总数（含所有层级） */
  num_comments: number;
  /** 发帖 Unix 时间戳（秒） */
  created_utc: number;
  /** 最近一次抓取 Unix 时间戳（秒） */
  fetched_at: number;
  /** 评论回捞阶段：0=未回捞，1=已完成 6h 回捞，2=已完成 12h 回捞；RSS 帖子直接为 2 */
  comment_pass: number;
  /** 最近一次评论回捞 Unix 时间戳（秒）；从未回捞时为 null */
  comments_fetched_at: number | null;
  /** AI 分析完成 Unix 时间戳（秒）；尚未分析时为 null */
  analyzed_at: number | null;
  /** 已尝试 AI 分析的次数；达到 3 次后不再重试 */
  analyze_attempts: number;
}

/** getPostsDueForComments() 的返回元素，携带目标回捞阶段 */
export interface DuePost {
  post: PostRow;
  /** 本次应完成的回捞阶段：1 = 6h 回捞，2 = 12h 回捞 */
  pass: 1 | 2;
}

/**
 * 写入帖子列表，已存在的帖子仅刷新动态字段（分数、评论数、标题、正文、抓取时间）。
 * - source 与 subreddit 字段在冲突更新时不会变更
 * @param posts 待写入的帖子列表
 * @param source 数据来源标识，如 `'reddit'` / `'hackernews'` / `'rss'`
 * @param fetchedAt 本次抓取 Unix 时间戳（秒）
 * @param initialCommentPass 新帖的初始回捞阶段；RSS 等无评论来源传 2 跳过回捞，默认 0
 * @returns 本批次新增数与更新数
 */
export function upsertPosts(
  posts: RedditPost[],
  source: string,
  fetchedAt: number,
  initialCommentPass = 0,
): { added: number; updated: number } {
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
  db.transaction(() => {
    for (const p of posts) {
      if (exists.get(p.id)) updated++;
      else added++;
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
  return { added, updated };
}

/**
 * 取出已到达 6h 或 12h 评论回捞窗口且尚未完成对应阶段的帖子。
 * @param now 当前 Unix 时间戳（秒）
 * @param limit 最多返回条数
 * @returns 带目标回捞阶段的帖子列表，按创建时间降序排列
 */
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
