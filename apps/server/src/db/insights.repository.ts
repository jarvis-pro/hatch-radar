import { Inject, Injectable } from '@nestjs/common';
import { Prisma, toInsight, type AppDatabase, type InsightPgRow } from '@hatch-radar/db';
import type {
  Insight,
  InsightFilter,
  InsightResult,
  Intensity,
  PostRow,
} from '@hatch-radar/shared';
import { PRISMA } from '../common/tokens';

/**
 * 洞察表数据访问（Prisma / PostgreSQL）。
 *
 * pain_points / opportunities / tags 在 PG 侧为 jsonb：写入直接传对象（Prisma 序列化），
 * 读出已是解析后的对象，经 mappers.toInsight 转 camelCase 视图。
 */
@Injectable()
export class InsightsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

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
      if (rank[p.intensity] > rank[intensity]) intensity = p.intensity;
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
}
