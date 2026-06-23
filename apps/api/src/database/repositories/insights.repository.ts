import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  Prisma,
  toInsight,
  type AppDatabase,
  type InsightPgRow,
  type TriagePgRow,
} from '@/database/internal';
import type {
  Insight,
  InsightFilter,
  InsightResult,
  Intensity,
  PostRow,
  RadarInsightFilter,
} from '@hatch-radar/shared';

/**
 * 洞察表数据访问（Prisma / PostgreSQL）。
 *
 * pain_points / opportunities / tags 在 PG 侧为 jsonb：写入直接传对象（Prisma 序列化），
 * 读出已是解析后的对象，经 mappers.toInsight 转 camelCase 视图。
 */
@Injectable()
export class InsightsRepository {
  constructor(
    // 事务感知 Prisma 客户端（经 @Inject(PRISMA)，按 ALS 自动路由事务/根客户端）：读写洞察（insights）表 + 关联 triage
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /**
   * 将 AI 分析结果落库为洞察记录。
   * - intensity 取所有 pain_points 中最高强度，作为整条洞察的索引强度
   * - 同一 post_id 重复写入时按 post_id 唯一键原地 UPDATE，保留 insights.id 不变
   *   （重分析不换 id，triage 等按 insight_id 的软引用因此不会悬空）
   * @param post 来源帖子行（提供 id / source / subreddit / title / permalink）
   * @param model 用于分析的模型 ID
   * @param insight AI 返回的结构化结果
   * @param createdAt 写入 Unix 时间戳（秒）
   */
  async saveInsight(
    post: PostRow,
    model: string,
    insight: InsightResult,
    createdAt: number,
  ): Promise<void> {
    const rank: Record<Intensity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    let intensity: Intensity = 'LOW';
    for (const p of insight.pain_points) {
      if (rank[p.intensity] > rank[intensity]) {
        intensity = p.intensity;
      }
    }

    const data = {
      source: post.source,
      subreddit: post.subreddit,
      post_title: post.title,
      permalink: post.permalink,
      model,
      intensity,
      pain_points: insight.pain_points as unknown as Prisma.InputJsonValue,
      opportunities: insight.opportunities as unknown as Prisma.InputJsonValue,
      tags: insight.tags,
      created_at: BigInt(createdAt),
    };
    await this.db.insights.upsert({
      where: { post_id: post.id },
      create: { post_id: post.id, ...data },
      update: data,
    });
  }

  /**
   * 按条件检索洞察结果，多个过滤条件以 AND 组合。
   * - subreddit 大小写不敏感；tag 在 jsonb 数组内做 ILIKE 子串匹配（jsonb_array_elements_text）
   * @param filter 过滤条件，所有字段可选
   * @returns 洞察列表，按 created_at 降序排列
   */
  async searchInsights(filter: InsightFilter): Promise<Insight[]> {
    const conds: Prisma.Sql[] = [];
    if (filter.subreddit) {
      conds.push(Prisma.sql`lower(subreddit) = lower(${filter.subreddit})`);
    }

    if (filter.intensity) {
      conds.push(Prisma.sql`intensity::text = ${filter.intensity.toUpperCase()}`);
    }

    if (filter.tag) {
      conds.push(
        Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS t(v) WHERE v ILIKE ${`%${filter.tag}%`})`,
      );
    }

    const where =
      conds.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    const rows = await this.db.$queryRaw<InsightPgRow[]>`
      SELECT * FROM insights
      ${where}
      ORDER BY created_at DESC
      LIMIT ${filter.limit ?? 20}
    `;

    return rows.map(toInsight);
  }

  // ─── 雷达只读视图（指挥室 / 收成洞察库 / 详情）─────────────────────────────────────

  /**
   * 创建时间 ≥ sinceSec 的洞察数（指挥室「今日洞察」）。
   * @param sinceSec 起始 Unix 时间戳（秒，含下界）
   */
  async countSince(sinceSec: number): Promise<number> {
    return this.db.insights.count({ where: { created_at: { gte: BigInt(sinceSec) } } });
  }

  /**
   * 收成洞察库筛选→Prisma where（与 {@link countForRadar} / {@link listForRadar} 同源）。
   * intensity 入库为大写枚举、q 对标题大小写不敏感子串。
   */
  private radarWhere(f: RadarInsightFilter): Prisma.insightsWhereInput {
    const where: Record<string, unknown> = {};
    if (f.source) {
      where.source = f.source;
    }

    if (f.subreddit) {
      where.subreddit = f.subreddit;
    }

    if (f.intensity) {
      where.intensity = f.intensity.toUpperCase();
    }

    if (f.q) {
      where.post_title = { contains: f.q, mode: 'insensitive' };
    }

    return where;
  }

  /**
   * 收成洞察库筛选后的总数（分页 total）。
   * @param f 洞察库筛选条件
   */
  async countForRadar(f: RadarInsightFilter): Promise<number> {
    return this.db.insights.count({ where: this.radarWhere(f) });
  }

  /**
   * 收成洞察库一页（原始 Prisma 行供服务合成 DTO）。
   * sort=pain 按强度升序 + 时间倒序，否则纯时间倒序。
   * @param f 洞察库筛选 + 排序条件
   * @param skip 分页偏移
   * @param take 本页条数
   */
  async listForRadar(f: RadarInsightFilter, skip: number, take: number): Promise<InsightPgRow[]> {
    const orderBy =
      f.sort === 'pain'
        ? [{ intensity: 'asc' as const }, { created_at: 'desc' as const }]
        : [{ created_at: 'desc' as const }];

    return this.db.insights.findMany({ where: this.radarWhere(f), orderBy, skip, take });
  }

  /**
   * 按 id 取单条洞察原始 Prisma 行；不存在返回 null。
   * @param id 洞察 id
   */
  async getRawById(id: number): Promise<InsightPgRow | null> {
    return this.db.insights.findUnique({ where: { id } });
  }

  /**
   * 按 post_id 取单条洞察原始 Prisma 行（一帖至多一条）；不存在返回 null。
   * @param postId 帖子 id
   */
  async getRawByPostId(postId: string): Promise<InsightPgRow | null> {
    return this.db.insights.findUnique({ where: { post_id: postId } });
  }

  /**
   * 取某洞察的人工研判（triage）原始行；无则 null。
   * @param insightId 洞察 id
   */
  async getTriageByInsightId(insightId: number): Promise<TriagePgRow | null> {
    return this.db.triage.findUnique({ where: { insight_id: insightId } });
  }

  /** 洞察去重的来源清单（升序，非空），供洞察库筛选下拉。 */
  async distinctSources(): Promise<string[]> {
    const rows = await this.db.insights.findMany({
      distinct: ['source'],
      select: { source: true },
      orderBy: { source: 'asc' },
    });

    return rows.map((r) => r.source).filter((s): s is string => Boolean(s));
  }

  /** 洞察去重的版块清单（升序，非空），供洞察库筛选下拉。 */
  async distinctSubreddits(): Promise<string[]> {
    const rows = await this.db.insights.findMany({
      distinct: ['subreddit'],
      select: { subreddit: true },
      orderBy: { subreddit: 'asc' },
    });

    return rows.map((r) => r.subreddit).filter((s): s is string => Boolean(s));
  }
}
