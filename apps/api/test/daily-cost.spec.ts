import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@/lib/db';
import { CostRepository } from '@/lib/db';
import { nowSec } from '@/lib/kernel';
import { setupTestDb, truncateAll } from './helpers';

/**
 * 看板每日成本走势聚合：密集 0 填充、按日分桶累加 token、按 provider 单价折算成本，
 * 且与 getCostStats（窗口总计）口径一致——两条统计路径共用 computeCost，必须对得上。
 * 数据源为 tasks(kind=analyze)（分析已全任务化；run_id 软引用、直插即可）。
 */
describe('CostRepository.getDailyCost（每日 token 用量 + 成本走势）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let cost: CostRepository;

  beforeAll(async () => {
    handle = await setupTestDb();
    db = handle.db;
    cost = new CostRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  /** 建一条模型配置（返回 id），prices 任一为 null 表示未配单价 */
  async function seedProvider(prices: {
    input: number | null;
    output: number | null;
  }): Promise<number> {
    const p = await db.model_providers.create({
      data: {
        provider: 'anthropic',
        label: 'test',
        model: 'm',
        input_price: prices.input,
        output_price: prices.output,
        created_at: BigInt(0),
        updated_at: BigInt(0),
      },
    });
    return p.id;
  }

  /** 直插一条 succeeded 且带 token 的 analyze 任务（绕过队列状态机，专测统计聚合） */
  async function seedTask(opts: {
    postId: string;
    providerId: number | null;
    finishedAt: number;
    input: number;
    output: number;
    cacheWrite?: number;
    cacheRead?: number;
  }): Promise<void> {
    await db.tasks.create({
      data: {
        run_id: 1, // 软引用，统计聚合不关心归属进程
        kind: 'analyze',
        post_id: opts.postId,
        provider_id: opts.providerId,
        model: 'm',
        status: 'succeeded',
        attempts: 1,
        max_attempts: 3,
        enqueued_at: BigInt(opts.finishedAt),
        finished_at: BigInt(opts.finishedAt),
        input_tokens: opts.input,
        output_tokens: opts.output,
        cache_write_tokens: opts.cacheWrite ?? 0,
        cache_read_tokens: opts.cacheRead ?? 0,
      },
    });
  }

  it('密集 0 填充、按日聚合 token，并与 getCostStats 总计口径一致', async () => {
    const DAYS = 14;
    const DAY = 86_400;
    const now = nowSec();
    const priced = await seedProvider({ input: 3, output: 15 }); // $/1M tokens
    const unpriced = await seedProvider({ input: null, output: null });

    // 今天 2 条（带价，其一含缓存）
    await seedTask({
      postId: 'a',
      providerId: priced,
      finishedAt: now,
      input: 1000,
      output: 200,
      cacheWrite: 100,
      cacheRead: 500,
    });
    await seedTask({ postId: 'b', providerId: priced, finishedAt: now, input: 2000, output: 400 });
    // 3 天前 1 条（带价）
    await seedTask({
      postId: 'c',
      providerId: priced,
      finishedAt: now - 3 * DAY,
      input: 500,
      output: 50,
    });
    // 1 天前 1 条（无价）→ 当天 cost 应为 null，但 token 计入
    await seedTask({
      postId: 'd',
      providerId: unpriced,
      finishedAt: now - DAY,
      input: 9999,
      output: 1,
    });
    // 窗口外 1 条（带价）→ 不计入
    await seedTask({
      postId: 'e',
      providerId: priced,
      finishedAt: now - (DAYS + 5) * DAY,
      input: 7777,
      output: 7,
    });

    const daily = await cost.getDailyCost(DAYS);

    // 密集：长度 = DAYS，日期升序且唯一
    expect(daily).toHaveLength(DAYS);
    const dates = daily.map((p) => p.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(DAYS);

    // token 合计排除窗口外那条
    const sumInput = daily.reduce((s, p) => s + p.inputTokens, 0);
    expect(sumInput).toBe(1000 + 2000 + 500 + 9999);

    // 每日成本累加 ≈ getCostStats 总成本（两条路径同源 computeCost，必须对得上）
    const stats = await cost.getCostStats(now - DAYS * DAY);
    const sumCost = daily.reduce((s, p) => s + (p.cost ?? 0), 0);
    expect(sumCost).toBeGreaterThan(0);
    expect(sumCost).toBeCloseTo(stats.totals.cost ?? 0, 9);

    // 无价模型独占的那天：token 有值但 cost = null
    const unpricedDay = daily.find((p) => p.inputTokens === 9999);
    expect(unpricedDay).toBeDefined();
    expect(unpricedDay!.cost).toBeNull();

    // 无任务的天：全 0、cost null
    const emptyDays = daily.filter((p) => p.inputTokens === 0);
    expect(emptyDays.length).toBeGreaterThan(0);
    for (const p of emptyDays) {
      expect(p.outputTokens).toBe(0);
      expect(p.cost).toBeNull();
    }
  });

  it('窗口内无任务时返回全 0 / cost=null 的密集序列', async () => {
    const daily = await cost.getDailyCost(7);
    expect(daily).toHaveLength(7);
    for (const p of daily) {
      expect(p.inputTokens).toBe(0);
      expect(p.cost).toBeNull();
    }
  });
});
