import type { RedditComment } from '../crawler/reddit';
import { getDb } from './schema';

/** comments 表的行结构 */
export interface CommentRow {
  id: string;
  /** 所属帖子 ID */
  post_id: string;
  /** 父评论 ID；顶层评论为 null */
  parent_id: string | null;
  /** 评论作者；账号已删除时为 null */
  author: string | null;
  body: string;
  /** 点赞数；HN 评论不暴露评分，恒为 0 */
  score: number;
  /** 评论深度：0 为顶层，1 为回复 */
  depth: number;
  /** 发评论 Unix 时间戳（秒） */
  created_utc: number;
  /** 本次回捞 Unix 时间戳（秒） */
  fetched_at: number;
}

/**
 * 整体替换帖子的评论快照并推进回捞阶段计数。
 * - 先删除原有评论再批量插入，保证快照与 API 返回一致
 * - `comment_pass` 取当前值与 pass 的较大值，防止意外回退
 * @param postId 目标帖子 ID
 * @param comments 从 API 抓取的最新评论列表；传空数组时仅推进阶段计数
 * @param pass 本次完成的回捞阶段（1 或 2）
 * @param fetchedAt 本次回捞 Unix 时间戳（秒）
 */
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

/**
 * 取出指定帖子的全部评论，按深度升序、分数降序排列。
 * @param postId 目标帖子 ID
 */
export function getCommentsForPost(postId: string): CommentRow[] {
  return getDb()
    .prepare(`SELECT * FROM comments WHERE post_id = ? ORDER BY depth ASC, score DESC`)
    .all(postId) as CommentRow[];
}
