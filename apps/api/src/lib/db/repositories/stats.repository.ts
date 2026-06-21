import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import type { BoardData, FunnelTrendPoint, NamedCount } from '@hatch-radar/shared';
import type { AppDatabase } from '../internal';
import { PENDING_ANALYSIS_PREDICATE } from './posts.repository';

/** 数据库各表计数概览 */
export interface DbStats {
  posts: number;
  comments: number;
  pendingAnalysis: number;
  insights: number;
}

/**
 * 计数概览数据访问，用于启动日志、健康检查与监控。
 */
@Injectable()
export class StatsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 返回数据库各表的当前行数汇总。
   * - 单条 SQL 一次往返取全部计数（health 探测每次都会调，避免 4 次独立查询）
   * - 待分析口径复用 {@link PENDING_ANALYSIS_PREDICATE}，与实际入队取数完全一致
   * @returns posts / comments / 待分析帖子数 / insights 的当前计数
   */
  async getStats(): Promise<DbStats> {
    const [row] = await this.db.$queryRaw<
      { posts: bigint; comments: bigint; pending: bigint; insights: bigint }[]
    >`
      SELECT
        (SELECT count(*) FROM posts) AS posts,
        (SELECT count(*) FROM comments) AS comments,
        (SELECT count(*) FROM posts WHERE ${PENDING_ANALYSIS_PREDICATE}) AS pending,
        (SELECT count(*) FROM insights) AS insights
    `;
    return {
      posts: Number(row?.posts ?? 0),
      comments: Number(row?.comments ?? 0),
      pendingAnalysis: Number(row?.pending ?? 0),
      insights: Number(row?.insights ?? 0),
    };
  }

  /** 洞察分布：按强度计数 + Top 版块（看板用） */
  async getInsightBreakdown(): Promise<{ byIntensity: NamedCount[]; topSubreddits: NamedCount[] }> {
    const [intensity, subs] = await Promise.all([
      this.db.insights.groupBy({ by: ['intensity'], _count: { _all: true } }),
      this.db.insights.groupBy({
        by: ['subreddit'],
        _count: { _all: true },
        orderBy: { _count: { subreddit: 'desc' } },
        take: 8,
      }),
    ]);
    return {
      byIntensity: intensity.map((i) => ({ name: i.intensity, count: i._count._all })),
      topSubreddits: subs.map((s) => ({ name: s.subreddit, count: s._count._all })),
    };
  }

  /**
   * 价值看板聚合（除 ROI 外，ROI 由控制器结合成本计算）：价值漏斗 + 每日趋势 + 强度/标签 + 来源。
   * @param since 起始 epoch 秒；null（累计）→ 0：不设时间下限。漏斗 collected/analyzed 锚 posts.fetched_at
   *   （同一批窗口内采集的帖子，保证 collected ≥ analyzed），insights 锚 created_at。
   * @param trendDays 趋势密集序列天数（始终回看最近 N 天，与 since 无关）。
   */
  async getBoard(since: number | null, trendDays: number): Promise<Omit<BoardData, 'roi'>> {
    const floor = since ?? 0;
    const [[funnelRow], funnelTrend, intensity, sources, topTags] = await Promise.all([
      this.db.$queryRaw<{ collected: bigint; analyzed: bigint; insights: bigint }[]>`
        SELECT
          (SELECT count(*) FROM posts WHERE fetched_at >= ${floor}) AS collected,
          (SELECT count(*) FROM posts WHERE fetched_at >= ${floor} AND analyzed_at IS NOT NULL) AS analyzed,
          (SELECT count(*) FROM insights WHERE created_at >= ${floor}) AS insights
      `,
      this.db.$queryRaw<FunnelTrendPoint[]>`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(i.cnt, 0)::int AS insights
        FROM generate_series(
          date_trunc('day', now()) - make_interval(days => ${trendDays - 1}),
          date_trunc('day', now()),
          interval '1 day'
        ) AS d(day)
        LEFT JOIN (
          SELECT date_trunc('day', to_timestamp(created_at::double precision)) AS day, count(*) AS cnt
          FROM insights
          WHERE created_at >= extract(epoch FROM (date_trunc('day', now()) - make_interval(days => ${trendDays - 1})))
          GROUP BY 1
        ) AS i ON i.day = d.day
        ORDER BY d.day
      `,
      this.db.insights.groupBy({
        by: ['intensity'],
        where: { created_at: { gte: BigInt(floor) } },
        _count: { _all: true },
      }),
      this.db.insights.groupBy({
        by: ['source'],
        where: { created_at: { gte: BigInt(floor) } },
        _count: { _all: true },
        orderBy: { _count: { source: 'desc' } },
      }),
      this.db.$queryRaw<{ name: string; count: number }[]>`
        SELECT tag AS name, count(*)::int AS count
        FROM insights, jsonb_array_elements_text(tags) AS tag
        WHERE created_at >= ${floor} AND jsonb_typeof(tags) = 'array'
        GROUP BY tag
        ORDER BY count DESC, tag
        LIMIT 12
      `,
    ]);
    return {
      funnel: {
        collected: Number(funnelRow?.collected ?? 0),
        analyzed: Number(funnelRow?.analyzed ?? 0),
        insights: Number(funnelRow?.insights ?? 0),
      },
      funnelTrend,
      quality: {
        byIntensity: intensity.map((i) => ({ name: i.intensity, count: i._count._all })),
        topTags,
      },
      sources: sources.map((s) => ({ name: s.source, count: s._count._all, verifiedRate: null })),
    };
  }
}
