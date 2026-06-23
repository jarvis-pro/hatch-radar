import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import { type CostByModel, type DailyCostPoint, type ThroughputPoint } from '@hatch-radar/shared';
import type { AppDatabase } from '../internal';

/**
 * 各 provider 缓存 token 相对「输入单价」的计费倍率（厂商固定口径，非自定义）：
 * - anthropic / claude_cli：写入缓存 1.25×、命中 0.1×
 * - openai：自动缓存无独立写入计费（0），命中约 0.5×
 * - deepseek：命中约 0.1×、无独立写入计费
 * 未知 provider 回退 1×（按普通输入计）。普通输入与输出各按其单价 1× 计。
 */
const CACHE_MULT: Record<string, { write: number; read: number }> = {
  anthropic: { write: 1.25, read: 0.1 },
  claude_cli: { write: 1.25, read: 0.1 },
  openai: { write: 0, read: 0.5 },
  deepseek: { write: 0, read: 0.1 },
};

/** 一组 token 用量（按类型拆分） */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/**
 * 按 provider 单价 + 缓存倍率把 token 用量折算成本（美元）。普通输入/输出各按其单价 1× 计，
 * 缓存写入 / 命中按 {@link CACHE_MULT} 相对输入单价计；单价缺失（input/output 任一为空）返回
 * null（该模型只统计用量、不折算）。getCostStats / getDailyCost 共用，保证两处口径一致。
 */
function computeCost(
  provider: string,
  inputPrice: number | null,
  outputPrice: number | null,
  t: TokenUsage,
): number | null {
  if (inputPrice == null || outputPrice == null) {
    return null;
  }
  const m = CACHE_MULT[provider] ?? { write: 1, read: 1 };
  return (
    (t.inputTokens * inputPrice +
      t.cacheWriteTokens * inputPrice * m.write +
      t.cacheReadTokens * inputPrice * m.read +
      t.outputTokens * outputPrice) /
    1_000_000
  );
}

/**
 * 成本 / 吞吐分析数据访问（Prisma / PostgreSQL）。数据源是 **tasks（kind=analyze）**——分析全由
 * 任务承载，看板成本与吞吐均自 tasks 派生（取代旧 analysis_jobs 路径）。与 model_providers 单价
 * 折算成本，与 insights 关联吞吐。纯只读聚合，不参与队列流转。
 */
@Injectable()
export class CostRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 成本统计（finished_at ≥ sinceSec 的成功分析任务）：按 (provider, model) 汇总四类 token，
   * 按各 provider 单价 + 缓存倍率（CACHE_MULT）折算成本；未配单价的模型 cost 为 null。
   */
  async getCostStats(sinceSec: number): Promise<{
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheWriteTokens: number;
      cacheReadTokens: number;
      cost: number | null;
    };
    byModel: CostByModel[];
  }> {
    const groups = await this.db.$queryRaw<
      {
        provider_id: number | null;
        model: string;
        input_tokens: number;
        output_tokens: number;
        cache_write_tokens: number;
        cache_read_tokens: number;
        jobs: number;
      }[]
    >`
      SELECT provider_id, model,
             sum(input_tokens)::int AS input_tokens,
             sum(coalesce(output_tokens, 0))::int AS output_tokens,
             sum(coalesce(cache_write_tokens, 0))::int AS cache_write_tokens,
             sum(coalesce(cache_read_tokens, 0))::int AS cache_read_tokens,
             count(*)::int AS jobs
      FROM tasks
      WHERE status = 'succeeded' AND kind = 'analyze' AND input_tokens IS NOT NULL
        AND finished_at >= ${sinceSec}
      GROUP BY provider_id, model
    `;
    const priceById = await this.loadPriceMap([
      ...new Set(groups.map((g) => g.provider_id).filter((id): id is number => id != null)),
    ]);

    const byModel: CostByModel[] = groups
      .map((g) => {
        const { input_tokens: inputTokens, output_tokens: outputTokens } = g;
        const { cache_write_tokens: cacheWriteTokens, cache_read_tokens: cacheReadTokens } = g;
        const price = g.provider_id != null ? priceById.get(g.provider_id) : undefined;
        const cost = price
          ? computeCost(price.provider, price.input_price, price.output_price, {
              inputTokens,
              outputTokens,
              cacheWriteTokens,
              cacheReadTokens,
            })
          : null;
        return {
          provider: price?.provider ?? 'unknown',
          model: g.model,
          jobs: g.jobs,
          inputTokens,
          outputTokens,
          cacheWriteTokens,
          cacheReadTokens,
          cost,
        };
      })
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.inputTokens - a.inputTokens);

    const totals = byModel.reduce(
      (acc, m) => ({
        inputTokens: acc.inputTokens + m.inputTokens,
        outputTokens: acc.outputTokens + m.outputTokens,
        cacheWriteTokens: acc.cacheWriteTokens + m.cacheWriteTokens,
        cacheReadTokens: acc.cacheReadTokens + m.cacheReadTokens,
        cost: m.cost == null ? acc.cost : (acc.cost ?? 0) + m.cost,
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        cost: null as number | null,
      },
    );
    return { totals, byModel };
  }

  /** 批量取 provider 单价表（id → {provider, 输入单价, 输出单价}），供成本折算复用。 */
  private async loadPriceMap(providerIds: number[]) {
    if (providerIds.length === 0) {
      return new Map<
        number,
        { provider: string; input_price: number | null; output_price: number | null }
      >();
    }
    const prices = await this.db.model_providers.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, provider: true, input_price: true, output_price: true },
    });
    return new Map(prices.map((p) => [p.id, p]));
  }

  /**
   * 近 days 天每日 token 用量与折算成本（0 填充的密集序列，服务端按统一时区分桶）。
   * 成本口径与 {@link getCostStats} 完全一致（按 provider 单价 + 缓存倍率折算）；当天没有任何
   * 带单价模型的任务时 cost 为 null（只有用量、不折算）。前端按 7/14/30 天切片即可画走势。
   */
  async getDailyCost(days: number): Promise<DailyCostPoint[]> {
    // 密集日期轴（DB 时区；与下方分桶同源 to_char，保证 key 对齐）
    const axis = await this.db.$queryRaw<{ date: string }[]>`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date
      FROM generate_series(
        date_trunc('day', now()) - make_interval(days => ${days - 1}),
        date_trunc('day', now()),
        interval '1 day'
      ) AS d(day)
      ORDER BY d.day
    `;
    // 窗口内 succeeded 且带 token 的分析任务，按「日 × provider」聚合用量（cost 需按 provider 单价折算）
    const rows = await this.db.$queryRaw<
      {
        date: string;
        provider_id: number | null;
        input_tokens: number;
        output_tokens: number;
        cache_write_tokens: number;
        cache_read_tokens: number;
      }[]
    >`
      SELECT
        to_char(date_trunc('day', to_timestamp(finished_at::double precision)), 'YYYY-MM-DD') AS date,
        provider_id,
        sum(input_tokens)::int AS input_tokens,
        sum(coalesce(output_tokens, 0))::int AS output_tokens,
        sum(coalesce(cache_write_tokens, 0))::int AS cache_write_tokens,
        sum(coalesce(cache_read_tokens, 0))::int AS cache_read_tokens
      FROM tasks
      WHERE status = 'succeeded' AND kind = 'analyze' AND input_tokens IS NOT NULL
        AND finished_at >= extract(epoch FROM (date_trunc('day', now()) - make_interval(days => ${days - 1})))
      GROUP BY 1, provider_id
    `;
    const priceById = await this.loadPriceMap([
      ...new Set(rows.map((r) => r.provider_id).filter((id): id is number => id != null)),
    ]);

    // 折算每组成本并按日累加（cost null 语义同 getCostStats：当天无带单价模型则保持 null）
    const empty = (date: string): DailyCostPoint => ({
      date,
      cost: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const byDate = new Map<string, DailyCostPoint>();
    for (const r of rows) {
      const acc = byDate.get(r.date) ?? empty(r.date);
      acc.inputTokens += r.input_tokens;
      acc.outputTokens += r.output_tokens;
      acc.cacheWriteTokens += r.cache_write_tokens;
      acc.cacheReadTokens += r.cache_read_tokens;
      const price = r.provider_id != null ? priceById.get(r.provider_id) : undefined;
      const cost = price
        ? computeCost(price.provider, price.input_price, price.output_price, {
            inputTokens: r.input_tokens,
            outputTokens: r.output_tokens,
            cacheWriteTokens: r.cache_write_tokens,
            cacheReadTokens: r.cache_read_tokens,
          })
        : null;
      if (cost != null) {
        acc.cost = (acc.cost ?? 0) + cost;
      }
      byDate.set(r.date, acc);
    }
    // 密集填充：无数据的日期补零（cost=null）
    return axis.map(({ date }) => byDate.get(date) ?? empty(date));
  }

  /** 近 days 天每日完成的分析任务数 + 当日洞察分布（0 填充的密集序列，服务端按统一时区分桶）。 */
  async getThroughput(days: number): Promise<ThroughputPoint[]> {
    return this.db.$queryRaw<ThroughputPoint[]>`
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS date,
        COALESCE(j.succeeded, 0)::int AS succeeded,
        COALESCE(j.failed, 0)::int AS failed,
        COALESCE(i.high, 0)::int AS "insightsHigh",
        COALESCE(i.medium, 0)::int AS "insightsMedium",
        COALESCE(i.low, 0)::int AS "insightsLow"
      FROM generate_series(
        date_trunc('day', now()) - make_interval(days => ${days - 1}),
        date_trunc('day', now()),
        interval '1 day'
      ) AS d(day)
      LEFT JOIN (
        SELECT
          date_trunc('day', to_timestamp(finished_at::double precision)) AS day,
          count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
          count(*) FILTER (WHERE status = 'failed') AS failed
        FROM tasks
        WHERE status IN ('succeeded', 'failed') AND kind = 'analyze'
          AND finished_at >= extract(epoch FROM (now() - make_interval(days => ${days})))
        GROUP BY 1
      ) AS j ON j.day = d.day
      LEFT JOIN (
        SELECT
          date_trunc('day', to_timestamp(created_at::double precision)) AS day,
          count(*) FILTER (WHERE intensity = 'HIGH') AS high,
          count(*) FILTER (WHERE intensity = 'MEDIUM') AS medium,
          count(*) FILTER (WHERE intensity = 'LOW') AS low
        FROM insights
        WHERE created_at >= extract(epoch FROM (now() - make_interval(days => ${days})))
        GROUP BY 1
      ) AS i ON i.day = d.day
      ORDER BY d.day
    `;
  }
}
