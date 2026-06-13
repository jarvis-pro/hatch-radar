import { Inject, Injectable } from '@nestjs/common';
import { and, desc, sql, type SQL } from 'drizzle-orm';
import { insights, toInsight, type AppDatabase } from '@hatch-radar/db';
import type {
  Insight,
  InsightFilter,
  InsightResult,
  Intensity,
  PostRow,
} from '@hatch-radar/shared';
import { DRIZZLE } from '../common/tokens';

/**
 * 洞察表数据访问（异步 Drizzle / PostgreSQL）。
 *
 * pain_points / opportunities / tags 在 PG 侧为 jsonb：写入时直接传对象（Drizzle 序列化），
 * 读出时已是解析后的对象，经 mappers.toInsight 转 camelCase 视图。
 */
@Injectable()
export class InsightsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: AppDatabase) {}

  /**
   * 将 AI 分析结果落库为洞察记录。
   * - intensity 取所有 pain_points 中最高强度，作为整条洞察的索引强度
   * - 同一 post_id 重复写入时按 post_id 唯一索引原地 UPDATE，保留 insights.id 不变
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
      if (rank[p.intensity] > rank[intensity]) intensity = p.intensity;
    }
    await this.db
      .insert(insights)
      .values({
        post_id: post.id,
        source: post.source,
        subreddit: post.subreddit,
        post_title: post.title,
        permalink: post.permalink,
        model,
        intensity,
        pain_points: insight.pain_points,
        opportunities: insight.opportunities,
        tags: insight.tags,
        created_at: createdAt,
      })
      .onConflictDoUpdate({
        target: insights.post_id,
        set: {
          source: sql`excluded.source`,
          subreddit: sql`excluded.subreddit`,
          post_title: sql`excluded.post_title`,
          permalink: sql`excluded.permalink`,
          model: sql`excluded.model`,
          intensity: sql`excluded.intensity`,
          pain_points: sql`excluded.pain_points`,
          opportunities: sql`excluded.opportunities`,
          tags: sql`excluded.tags`,
          created_at: sql`excluded.created_at`,
        },
      });
  }

  /**
   * 按条件检索洞察结果，多个过滤条件以 AND 组合。
   * @param filter 过滤条件，所有字段可选
   * @returns 洞察列表，按 created_at 降序排列
   */
  async searchInsights(filter: InsightFilter): Promise<Insight[]> {
    const conds: SQL[] = [];
    if (filter.subreddit) {
      conds.push(sql`lower(${insights.subreddit}) = lower(${filter.subreddit})`);
    }
    if (filter.intensity) {
      conds.push(sql`${insights.intensity}::text = ${filter.intensity.toUpperCase()}`);
    }
    if (filter.tag) {
      conds.push(
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${insights.tags}) AS t(v) WHERE v ILIKE ${`%${filter.tag}%`})`,
      );
    }
    const rows = await this.db
      .select()
      .from(insights)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(insights.created_at))
      .limit(filter.limit ?? 20);
    return rows.map(toInsight);
  }
}
