import { Inject, Injectable } from '@nestjs/common';
import { Prisma, toCommentRow, type AppDatabase, type CommentRow } from '@hatch-radar/db';
import type { RedditComment } from '@/crawler/reddit';
import { PRISMA } from '@/common/tokens';

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
 * 评论表数据访问（Prisma / PostgreSQL）。
 */
@Injectable()
export class CommentsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 整体替换帖子的评论快照并推进回捞阶段计数。
   * - 先删除原有评论再批量插入，保证快照与 API 返回一致
   * - `comment_pass` 取当前值与 pass 的较大值（GREATEST），防止意外回退
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
    await this.db.$transaction(async (tx) => {
      const prev = await tx.comments.findMany({
        where: { post_id: postId },
        select: { id: true, score: true, body: true },
      });
      const changed = commentsFingerprint(prev) !== commentsFingerprint(incoming);

      await tx.comments.deleteMany({ where: { post_id: postId } });
      if (incoming.length > 0) {
        await tx.comments.createMany({
          data: incoming.map((c) => ({
            id: c.id,
            post_id: postId,
            parent_id: c.parentId,
            author: c.author,
            body: c.body,
            score: c.score,
            depth: c.depth,
            created_utc: BigInt(c.createdUtc),
            fetched_at: BigInt(fetchedAt),
          })),
          skipDuplicates: true,
        });
      }

      // GREATEST / 条件保留旧值无法用 Prisma update 表达 → $executeRaw（仍在同一事务内）
      await tx.$executeRaw`
        UPDATE posts SET
          comment_pass = GREATEST(comment_pass, ${pass}),
          comments_fetched_at = ${BigInt(fetchedAt)},
          comments_changed_at = ${changed ? Prisma.sql`${BigInt(fetchedAt)}` : Prisma.sql`comments_changed_at`}
        WHERE id = ${postId}
      `;
    });
  }

  /**
   * 取出指定帖子的全部评论，按深度升序、分数降序排列。
   * @param postId 目标帖子 ID
   */
  async getCommentsForPost(postId: string): Promise<CommentRow[]> {
    const rows = await this.db.comments.findMany({
      where: { post_id: postId },
      orderBy: [{ depth: 'asc' }, { score: 'desc' }],
    });
    return rows.map(toCommentRow);
  }
}
