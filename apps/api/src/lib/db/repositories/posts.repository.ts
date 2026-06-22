import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  Prisma,
  contentHash,
  toPostRow,
  type AppDatabase,
  type PostPg,
  type PostRow,
} from '../internal';
import type { RadarPostFilter, RedditPost } from '@hatch-radar/shared';

/** 评论 refresh 节奏与冻结策略（秒） */
const REFRESH = {
  /** 发帖 24h 内视为活跃热帖，按 youngInterval 频繁回捞 */
  youngAge: 24 * 3600,
  youngInterval: 25 * 60,
  /** 7 天以上不再 refresh（但从未抓过的仍会被抓一次） */
  maxAge: 7 * 86400,
  midInterval: 24 * 3600,
};

/** 分析失败重试上限：analyze_attempts 达到此值后不再自动（重）分析该帖 */
export const MAX_ANALYZE_ATTEMPTS = 3;

/**
 * 「待（重）分析」帖子的判定谓词——getPostsToAnalyze 取数与 StatsRepository 计数的单一数据源
 * （避免谓词散落多处、改一处漏一处导致看板数与实际入队数对不上）。
 * - 已完成至少一轮评论回捞（comment_pass >= 1），失败次数未达上限
 * - 从未分析（analyzed_at IS NULL）**或** 分析后评论又有变化（comments_changed_at > analyzed_at）
 *   后者接通「反馈后又变」的自动重分析；重分析成功后 markAnalyzed 前移 analyzed_at，
 *   令 comments_changed_at <= analyzed_at，自然收敛、不空转。
 */
export const PENDING_ANALYSIS_PREDICATE = Prisma.sql`
  comment_pass >= 1
  AND analyze_attempts < ${MAX_ANALYZE_ATTEMPTS}
  AND (analyzed_at IS NULL OR comments_changed_at > analyzed_at)
`;

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

      // 入库即算标题/正文内容哈希（decode 后规范化的 sha256），供译文按内容寻址、判定未翻译。
      const values = Prisma.join(
        items.map(
          (p) =>
            Prisma.sql`(${p.id}, ${source}, ${p.subreddit}, ${p.title}, ${p.author ?? null}, ${p.selftext}, ${p.url ?? null}, ${p.permalink ?? null}, ${p.score}, ${p.numComments}, ${p.createdUtc}, ${fetchedAt}, ${initialCommentPass}, ${contentHash(p.title)}, ${contentHash(p.selftext)})`,
        ),
      );
      await tx.$executeRaw`
        INSERT INTO posts (id, source, subreddit, title, author, selftext, url, permalink, score, num_comments, created_utc, fetched_at, comment_pass, title_hash, selftext_hash)
        VALUES ${values}
        ON CONFLICT (id) DO UPDATE SET
          title = excluded.title,
          selftext = excluded.selftext,
          score = excluded.score,
          num_comments = excluded.num_comments,
          fetched_at = excluded.fetched_at,
          title_hash = excluded.title_hash,
          selftext_hash = excluded.selftext_hash
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
   * 取出等待 AI（重）分析的帖子（判定见 {@link PENDING_ANALYSIS_PREDICATE}）：
   * 已完成至少一轮评论回捞、失败次数未达上限、且尚未分析或分析后评论又有变化。
   * - 按 `(score + num_comments)` 降序排列，优先处理热度高的帖子
   * @param limit 最多返回条数
   */
  async getPostsToAnalyze(limit: number): Promise<PostRow[]> {
    const rows = await this.db.$queryRaw<PostPg[]>`
      SELECT * FROM posts
      WHERE ${PENDING_ANALYSIS_PREDICATE}
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
   * 取「到期」复查的旧帖（recheck_due_sweep ≤ sweep）：已抓过评论（comment_pass≥1）、非 rss（无评论）。
   * 按到期序 + 热度排；配合指数退避，沉默帖会被跳过越来越多 sweep。
   * @param sweep 当前复查 sweep 序号
   * @param limit 最多返回条数
   */
  async getPostsToRecheck(sweep: number, limit: number): Promise<PostRow[]> {
    const rows = await this.db.$queryRaw<PostPg[]>`
      SELECT * FROM posts
      WHERE source <> 'rss'
        AND comment_pass >= 1
        AND recheck_due_sweep <= ${sweep}
      ORDER BY recheck_due_sweep ASC, (score + num_comments) DESC
      LIMIT ${limit}
    `;
    return rows.map(toPostRow);
  }

  /**
   * 写回复查结果状态：连续未变次数 / 下次到期 sweep / 最近复查时间。
   * 评论变化标记（comments_changed_at）由 {@link CommentsRepository.replaceComments} 内处理。
   */
  async updateRecheckState(
    postId: string,
    state: { misses: number; dueSweep: number; lastRecheckedAt: number },
  ): Promise<void> {
    await this.db.posts.update({
      where: { id: postId },
      data: {
        recheck_misses: state.misses,
        recheck_due_sweep: state.dueSweep,
        last_rechecked_at: BigInt(state.lastRecheckedAt),
      },
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

  // ─── 雷达只读视图（指挥室 / 帖子库 / 详情）─────────────────────────────────────────

  /** 抓取时间 ≥ sinceSec 的帖子数（指挥室「今日采集」）。 */
  async countFetchedSince(sinceSec: number): Promise<number> {
    return this.db.posts.count({ where: { fetched_at: { gte: BigInt(sinceSec) } } });
  }

  /** 到期可复查的旧帖数（非 rss、已抓评论、recheck_due_sweep ≤ sweep），供指挥室复查健康。 */
  async countRecheckDue(sweep: number): Promise<number> {
    return this.db.posts.count({
      where: {
        source: { not: 'rss' },
        comment_pass: { gte: 1 },
        recheck_due_sweep: { lte: sweep },
      },
    });
  }

  /**
   * 复查未变次数（recheck_misses）分布：非 rss、已抓评论的帖子按 misses 计数，升序。
   * 供指挥室「退避分布」直方图。
   */
  async recheckMissesDistribution(): Promise<{ misses: number; count: number }[]> {
    const rows = await this.db.posts.groupBy({
      by: ['recheck_misses'],
      where: { source: { not: 'rss' }, comment_pass: { gte: 1 } },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ misses: r.recheck_misses, count: r._count._all }))
      .sort((a, b) => a.misses - b.misses);
  }

  /**
   * 帖子库筛选→Prisma where（与 {@link listForRadar} / {@link countForRadar} 同源，避免谓词散落）。
   * status：new=未复查过 / quiet=退避中（misses>0）/ due=到期可查（非 rss、已抓评论、due_sweep ≤ sweep）。
   */
  private radarWhere(f: RadarPostFilter, sweep: number): Prisma.postsWhereInput {
    const where: Record<string, unknown> = {};
    if (f.source) where.source = f.source;
    if (f.subreddit) where.subreddit = f.subreddit;
    if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
    if (f.status === 'new') where.last_rechecked_at = null;
    else if (f.status === 'quiet') where.recheck_misses = { gt: 0 };
    else if (f.status === 'due')
      Object.assign(where, {
        source: { not: 'rss' },
        comment_pass: { gte: 1 },
        recheck_due_sweep: { lte: sweep },
      });
    return where;
  }

  /** 帖子库筛选后的总数（分页 total）。 */
  async countForRadar(f: RadarPostFilter, sweep: number): Promise<number> {
    return this.db.posts.count({ where: this.radarWhere(f, sweep) });
  }

  /** 帖子库一页（created_utc 倒序，原始 Prisma 行供服务合成 DTO）。 */
  async listForRadar(
    f: RadarPostFilter,
    sweep: number,
    skip: number,
    take: number,
  ): Promise<PostPg[]> {
    return this.db.posts.findMany({
      where: this.radarWhere(f, sweep),
      orderBy: { created_utc: 'desc' },
      skip,
      take,
    });
  }

  /** 按 id 取单帖原始 Prisma 行（供帖子一生详情合成）；不存在返回 null。 */
  async getRawById(id: string): Promise<PostPg | null> {
    return this.db.posts.findUnique({ where: { id } });
  }

  /** 帖子是否在库（含 30 天归档后已删除则不在）。供洞察详情标注源帖是否仍存在。 */
  async exists(id: string): Promise<boolean> {
    const row = await this.db.posts.findUnique({ where: { id }, select: { id: true } });
    return row != null;
  }

  /** 一批帖子 id → title_hash（供按内容哈希 join 译文标题）。 */
  async titleHashByIds(ids: string[]): Promise<Map<string, string | null>> {
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return new Map();
    const rows = await this.db.posts.findMany({
      where: { id: { in: uniq } },
      select: { id: true, title_hash: true },
    });
    return new Map(rows.map((p) => [p.id, p.title_hash]));
  }

  /** 一批帖子 id → {id, source, title}（供运行详情任务树标注来源 / 标题）。 */
  async listSummaryByIds(ids: string[]): Promise<{ id: string; source: string; title: string }[]> {
    if (ids.length === 0) return [];
    return this.db.posts.findMany({
      where: { id: { in: ids } },
      select: { id: true, source: true, title: true },
    });
  }
}
