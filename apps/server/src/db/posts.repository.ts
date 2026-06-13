import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { posts, comments, type AppDatabase, type PostRow } from '@hatch-radar/db';
import type { RedditPost } from '../crawler/reddit';
import { DRIZZLE } from '../common/tokens';

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
 * 帖子表数据访问（异步 Drizzle / PostgreSQL）。
 */
@Injectable()
export class PostsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: AppDatabase) {}

  /**
   * 写入帖子列表，已存在的帖子仅刷新动态字段（分数、评论数、标题、正文、抓取时间）。
   * - source 与 subreddit 字段在冲突更新时不会变更
   * @param items 待写入的帖子列表
   * @param source 数据来源标识，如 `'reddit'` / `'hackernews'` / `'rss'`
   * @param fetchedAt 本次抓取 Unix 时间戳（秒）
   * @param initialCommentPass 新帖的初始回捞阶段；RSS 等无评论来源传 2 跳过回捞，默认 0
   * @returns 本批次新增数、更新数，以及新增帖子的 `{ id, subreddit }`（供 scan 触发即时抓评论）
   */
  async upsertPosts(
    items: RedditPost[],
    source: string,
    fetchedAt: number,
    initialCommentPass = 0,
  ): Promise<{ added: number; updated: number; newPosts: { id: string; subreddit: string }[] }> {
    if (items.length === 0) return { added: 0, updated: 0, newPosts: [] };
    return this.db.transaction(async (tx) => {
      const ids = items.map((p) => p.id);
      const existingRows = await tx
        .select({ id: posts.id })
        .from(posts)
        .where(inArray(posts.id, ids));
      const existing = new Set(existingRows.map((r) => r.id));
      const newPosts = items
        .filter((p) => !existing.has(p.id))
        .map((p) => ({ id: p.id, subreddit: p.subreddit }));

      await tx
        .insert(posts)
        .values(
          items.map((p) => ({
            id: p.id,
            source,
            subreddit: p.subreddit,
            title: p.title,
            author: p.author,
            selftext: p.selftext,
            url: p.url,
            permalink: p.permalink,
            score: p.score,
            num_comments: p.numComments,
            created_utc: p.createdUtc,
            fetched_at: fetchedAt,
            comment_pass: initialCommentPass,
          })),
        )
        .onConflictDoUpdate({
          target: posts.id,
          set: {
            title: sql`excluded.title`,
            selftext: sql`excluded.selftext`,
            score: sql`excluded.score`,
            num_comments: sql`excluded.num_comments`,
            fetched_at: sql`excluded.fetched_at`,
          },
        });

      return { added: newPosts.length, updated: items.length - newPosts.length, newPosts };
    });
  }

  /**
   * 取需要（重新）抓取评论的帖子：从未抓过的优先，其余按帖龄衰减的节奏 refresh。
   * - 排除 RSS（无评论）
   * - <24h 热帖每轮回捞、24h–7d 帖每日回捞、>7d 不再 refresh
   * @param now 当前 Unix 时间戳（秒）
   * @param limit 最多返回条数
   */
  getPostsNeedingCommentRefresh(now: number, limit: number): Promise<PostRow[]> {
    return this.db
      .select()
      .from(posts)
      .where(
        and(
          ne(posts.source, 'rss'),
          sql`(
            ${posts.comments_fetched_at} IS NULL
            OR (${posts.created_utc} > ${now - REFRESH.youngAge} AND ${posts.comments_fetched_at} < ${now - REFRESH.youngInterval})
            OR (${posts.created_utc} > ${now - REFRESH.maxAge} AND ${posts.comments_fetched_at} < ${now - REFRESH.midInterval})
          )`,
        ),
      )
      .orderBy(sql`(${posts.comments_fetched_at} IS NOT NULL)`, desc(posts.created_utc))
      .limit(limit);
  }

  /**
   * 取出等待 AI 分析的帖子：已完成至少一轮评论回捞、尚未分析、失败次数不超过 2 次。
   * - 按 `(score + num_comments)` 降序排列，优先处理热度高的帖子
   * @param limit 最多返回条数
   */
  getPostsToAnalyze(limit: number): Promise<PostRow[]> {
    return this.db
      .select()
      .from(posts)
      .where(
        and(isNull(posts.analyzed_at), gte(posts.comment_pass, 1), lt(posts.analyze_attempts, 3)),
      )
      .orderBy(sql`(${posts.score} + ${posts.num_comments}) desc`)
      .limit(limit);
  }

  /**
   * 按 ID 取单篇帖子。
   * @param id 帖子 ID
   * @returns 帖子行；不存在（含 30 天归档后已删除）时返回 undefined
   */
  async getPostById(id: string): Promise<PostRow | undefined> {
    const rows = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    return rows[0];
  }

  /**
   * 将帖子标记为已完成 AI 分析。
   * @param postId 目标帖子 ID
   * @param analyzedAt 分析完成 Unix 时间戳（秒）
   */
  async markAnalyzed(postId: string, analyzedAt: number): Promise<void> {
    await this.db.update(posts).set({ analyzed_at: analyzedAt }).where(eq(posts.id, postId));
  }

  /**
   * 将帖子的分析尝试次数加一。
   * - 达到 3 次后 getPostsToAnalyze() 不再返回该帖子
   * @param postId 目标帖子 ID
   */
  async bumpAnalyzeAttempts(postId: string): Promise<void> {
    await this.db
      .update(posts)
      .set({ analyze_attempts: sql`${posts.analyze_attempts} + 1` })
      .where(eq(posts.id, postId));
  }

  /**
   * 清理早于 cutoff 时间戳的帖子与关联评论，洞察结果永久保留。
   * - 先删评论再删帖子，返回实际删除条数
   * @param cutoff Unix 时间戳（秒），早于此时间的帖子将被删除
   * @returns 被删除的帖子数与评论数
   */
  async archiveOldData(cutoff: number): Promise<{ posts: number; comments: number }> {
    return this.db.transaction(async (tx) => {
      const oldPostIds = tx
        .select({ id: posts.id })
        .from(posts)
        .where(lt(posts.created_utc, cutoff));
      const deletedComments = await tx
        .delete(comments)
        .where(inArray(comments.post_id, oldPostIds))
        .returning({ id: comments.id });
      const deletedPosts = await tx
        .delete(posts)
        .where(lt(posts.created_utc, cutoff))
        .returning({ id: posts.id });
      return { posts: deletedPosts.length, comments: deletedComments.length };
    });
  }
}
