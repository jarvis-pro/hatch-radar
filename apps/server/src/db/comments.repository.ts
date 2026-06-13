import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { comments, posts, type AppDatabase, type CommentRow } from '@hatch-radar/db';
import type { RedditComment } from '../crawler/reddit';
import { DRIZZLE } from '../common/tokens';

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
 * 评论表数据访问（异步 Drizzle / PostgreSQL）。
 */
@Injectable()
export class CommentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: AppDatabase) {}

  /**
   * 整体替换帖子的评论快照并推进回捞阶段计数。
   * - 先删除原有评论再批量插入，保证快照与 API 返回一致
   * - `comment_pass` 取当前值与 pass 的较大值，防止意外回退
   * - 评论内容（id/score/body）较上次快照有变化时，前移 `comments_changed_at`（驱动「反馈后又变」重列）
   * @param postId 目标帖子 ID
   * @param incoming 从 API 抓取的最新评论列表；传空数组时仅推进阶段计数
   * @param pass 本次完成的回捞阶段（1 或 2）
   * @param fetchedAt 本次回捞 Unix 时间戳（秒）
   */
  async replaceComments(
    postId: string,
    incoming: RedditComment[],
    pass: number,
    fetchedAt: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const prev = await tx
        .select({ id: comments.id, score: comments.score, body: comments.body })
        .from(comments)
        .where(eq(comments.post_id, postId));
      const changed = commentsFingerprint(prev) !== commentsFingerprint(incoming);

      await tx.delete(comments).where(eq(comments.post_id, postId));
      if (incoming.length > 0) {
        await tx
          .insert(comments)
          .values(
            incoming.map((c) => ({
              id: c.id,
              post_id: postId,
              parent_id: c.parentId,
              author: c.author,
              body: c.body,
              score: c.score,
              depth: c.depth,
              created_utc: c.createdUtc,
              fetched_at: fetchedAt,
            })),
          )
          .onConflictDoNothing();
      }

      await tx
        .update(posts)
        .set({
          comment_pass: sql`GREATEST(${posts.comment_pass}, ${pass})`,
          comments_fetched_at: fetchedAt,
          comments_changed_at: changed ? fetchedAt : sql`${posts.comments_changed_at}`,
        })
        .where(eq(posts.id, postId));
    });
  }

  /**
   * 取出指定帖子的全部评论，按深度升序、分数降序排列。
   * @param postId 目标帖子 ID
   */
  getCommentsForPost(postId: string): Promise<CommentRow[]> {
    return this.db
      .select()
      .from(comments)
      .where(eq(comments.post_id, postId))
      .orderBy(asc(comments.depth), desc(comments.score));
  }
}
