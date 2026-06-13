import type { CommentRow } from '@hatch-radar/shared';
import type { RedditComment } from '../crawler/reddit';
import { getDb } from './schema';

/**
 * 评论快照指纹（id+score+body，排序后拼接），用于判断本次抓取是否带来内容变化。
 * @param rows 评论行（仅取 id / score / body 三个判别字段）
 */
function commentsFingerprint(rows: { id: string; score: number; body: string }[]): string {
  return rows
    .map((r) => `${r.id}\t${r.score}\t${r.body}`)
    .sort()
    .join('\n');
}

/**
 * 整体替换帖子的评论快照并推进回捞阶段计数。
 * - 先删除原有评论再批量插入，保证快照与 API 返回一致
 * - `comment_pass` 取当前值与 pass 的较大值，防止意外回退
 * - 评论内容（id/score/body）较上次快照有变化时，前移 `comments_changed_at`（驱动「反馈后又变」重列）
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
  // 与现有快照对比：内容有变才前移 comments_changed_at
  const prev = db.prepare(`SELECT id, score, body FROM comments WHERE post_id = ?`).all(postId) as {
    id: string;
    score: number;
    body: string;
  }[];
  const changed = commentsFingerprint(prev) !== commentsFingerprint(comments);
  const del = db.prepare(`DELETE FROM comments WHERE post_id = ?`);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO comments (id, post_id, parent_id, author, body, score, depth, created_utc, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const bump = db.prepare(`
    UPDATE posts
    SET comment_pass = MAX(comment_pass, ?),
        comments_fetched_at = ?,
        comments_changed_at = CASE WHEN ? = 1 THEN ? ELSE comments_changed_at END
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
    bump.run(pass, fetchedAt, changed ? 1 : 0, fetchedAt, postId);
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
