import { Inject, Injectable } from '@nestjs/common';
import { Prisma, toPostRow, type AppDatabase, type PostPg, type PostRow } from '@hatch-radar/db';
import type { RedditPost } from '../crawler/reddit';
import { PRISMA } from '../common/tokens';

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
 * 帖子表数据访问（Prisma / PostgreSQL）。
 */
@Injectable()
export class PostsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 写入帖子列表，已存在的帖子仅刷新动态字段（分数、评论数、标题、正文、抓取时间）。
   * - source 与 subreddit 字段在冲突更新时不会变更
   * - 批量 `INSERT … ON CONFLICT DO UPDATE`（单语句，走 $executeRaw：Prisma 无批量 upsert）
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
    return this.db.$transaction(async (tx) => {
      const ids = items.map((p) => p.id);
      const existingRows = await tx.posts.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const existing = new Set(existingRows.map((r) => r.id));
      const newPosts = items
        .filter((p) => !existing.has(p.id))
        .map((p) => ({ id: p.id, subreddit: p.subreddit }));

      const values = Prisma.join(
        items.map(
          (p) =>
            Prisma.sql`(${p.id}, ${source}, ${p.subreddit}, ${p.title}, ${p.author ?? null}, ${p.selftext}, ${p.url ?? null}, ${p.permalink ?? null}, ${p.score}, ${p.numComments}, ${p.createdUtc}, ${fetchedAt}, ${initialCommentPass})`,
        ),
      );
      await tx.$executeRaw`
        INSERT INTO posts (id, source, subreddit, title, author, selftext, url, permalink, score, num_comments, created_utc, fetched_at, comment_pass)
        VALUES ${values}
        ON CONFLICT (id) DO UPDATE SET
          title = excluded.title,
          selftext = excluded.selftext,
          score = excluded.score,
          num_comments = excluded.num_comments,
          fetched_at = excluded.fetched_at
      `;

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
  async getPostsNeedingCommentRefresh(now: number, limit: number): Promise<PostRow[]> {
    const rows = await this.db.$queryRaw<PostPg[]>`
      SELECT * FROM posts
      WHERE source <> 'rss'
        AND (
          comments_fetched_at IS NULL
          OR (created_utc > ${now - REFRESH.youngAge} AND comments_fetched_at < ${now - REFRESH.youngInterval})
          OR (created_utc > ${now - REFRESH.maxAge} AND comments_fetched_at < ${now - REFRESH.midInterval})
        )
      ORDER BY (comments_fetched_at IS NOT NULL), created_utc DESC
      LIMIT ${limit}
    `;
    return rows.map(toPostRow);
  }

  /**
   * 取出等待 AI 分析的帖子：已完成至少一轮评论回捞、尚未分析、失败次数不超过 2 次。
   * - 按 `(score + num_comments)` 降序排列，优先处理热度高的帖子
   * @param limit 最多返回条数
   */
  async getPostsToAnalyze(limit: number): Promise<PostRow[]> {
    const rows = await this.db.$queryRaw<PostPg[]>`
      SELECT * FROM posts
      WHERE analyzed_at IS NULL AND comment_pass >= 1 AND analyze_attempts < 3
      ORDER BY (score + num_comments) DESC
      LIMIT ${limit}
    `;
    return rows.map(toPostRow);
  }

  /**
   * 按 ID 取单篇帖子。
   * @param id 帖子 ID
   * @returns 帖子行；不存在（含 30 天归档后已删除）时返回 undefined
   */
  async getPostById(id: string): Promise<PostRow | undefined> {
    const row = await this.db.posts.findUnique({ where: { id } });
    return row ? toPostRow(row) : undefined;
  }

  /**
   * 将帖子标记为已完成 AI 分析。
   * @param postId 目标帖子 ID
   * @param analyzedAt 分析完成 Unix 时间戳（秒）
   */
  async markAnalyzed(postId: string, analyzedAt: number): Promise<void> {
    await this.db.posts.update({
      where: { id: postId },
      data: { analyzed_at: BigInt(analyzedAt) },
    });
  }

  /**
   * 将帖子的分析尝试次数加一。
   * - 达到 3 次后 getPostsToAnalyze() 不再返回该帖子
   * @param postId 目标帖子 ID
   */
  async bumpAnalyzeAttempts(postId: string): Promise<void> {
    await this.db.posts.update({
      where: { id: postId },
      data: { analyze_attempts: { increment: 1 } },
    });
  }

  /**
   * 清理早于 cutoff 时间戳的帖子与关联评论，洞察结果永久保留。
   * - 先删评论（取得删除数）再删帖子，返回实际删除条数
   * @param cutoff Unix 时间戳（秒），早于此时间的帖子将被删除
   * @returns 被删除的帖子数与评论数
   */
  async archiveOldData(cutoff: number): Promise<{ posts: number; comments: number }> {
    return this.db.$transaction(async (tx) => {
      const old = await tx.posts.findMany({
        where: { created_utc: { lt: BigInt(cutoff) } },
        select: { id: true },
      });
      if (old.length === 0) return { posts: 0, comments: 0 };
      const ids = old.map((p) => p.id);
      const deletedComments = await tx.comments.deleteMany({ where: { post_id: { in: ids } } });
      const deletedPosts = await tx.posts.deleteMany({
        where: { created_utc: { lt: BigInt(cutoff) } },
      });
      return { posts: deletedPosts.count, comments: deletedComments.count };
    });
  }
}
