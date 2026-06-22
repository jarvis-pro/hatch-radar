import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StatsRepository, type AppDatabase, type DbHandle } from '@/database';
import { nowSec } from '@/utils/time';
import { setupTestDb, truncateAll } from './helpers';

/**
 * 价值看板聚合（StatsRepository.getBoard，真连 PG）：验证漏斗计数、强度/标签/来源聚合与窗口过滤，
 * 重点覆盖 jsonb_array_elements_text(tags) 标签展开与 fetched_at/analyzed_at 漏斗口径。
 */
describe('StatsRepository.getBoard（价值看板聚合）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let stats: StatsRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    stats = new StatsRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  /** 造一条帖子（at = fetched_at = created_utc；analyzed 为真时设 analyzed_at）。 */
  async function seedPost(
    id: string,
    source: string,
    opts: { at?: number; analyzed?: boolean } = {},
  ): Promise<void> {
    const at = opts.at ?? nowSec();
    await db.posts.create({
      data: {
        id,
        source,
        subreddit: 'SaaS',
        title: id,
        selftext: '',
        score: 1,
        num_comments: 0,
        created_utc: BigInt(at),
        fetched_at: BigInt(at),
        comment_pass: 1,
        analyzed_at: opts.analyzed ? BigInt(at) : null,
      },
    });
  }

  /** 造一条洞察（source/intensity/tags/created_at 可控）。 */
  async function seedInsight(
    postId: string,
    source: string,
    intensity: 'HIGH' | 'MEDIUM' | 'LOW',
    tags: string[],
    at = nowSec(),
  ): Promise<void> {
    await db.insights.create({
      data: {
        post_id: postId,
        source,
        subreddit: 'SaaS',
        post_title: postId,
        model: 'model-x',
        intensity,
        pain_points: [{ title: 't', description: 'd', intensity }],
        opportunities: [{ title: 'o' }],
        tags,
        created_at: BigInt(at),
      },
    });
  }

  it('累计（since=null）：漏斗 / 强度 / 标签 / 来源 计数与形状正确', async () => {
    // 3 帖：p1/p2 已分析、p3 未分析；p1=reddit p2=hackernews p3=reddit
    await seedPost('p1', 'reddit', { analyzed: true });
    await seedPost('p2', 'hackernews', { analyzed: true });
    await seedPost('p3', 'reddit', { analyzed: false });
    // 2 洞察：i1(reddit,HIGH,[churn,retention]) i2(hackernews,MEDIUM,[pricing,churn])
    await seedInsight('p1', 'reddit', 'HIGH', ['churn', 'retention']);
    await seedInsight('p2', 'hackernews', 'MEDIUM', ['pricing', 'churn']);

    const board = await stats.getBoard(null, 30);

    expect(board.funnel).toEqual({ collected: 3, analyzed: 2, insights: 2 });

    const intensity = Object.fromEntries(board.quality.byIntensity.map((x) => [x.name, x.count]));
    expect(intensity).toEqual({ HIGH: 1, MEDIUM: 1 });

    // 标签展开：churn 跨两条洞察 → 2；retention / pricing 各 1，按计数降序
    const tags = Object.fromEntries(board.quality.topTags.map((x) => [x.name, x.count]));
    expect(tags).toEqual({ churn: 2, retention: 1, pricing: 1 });
    expect(board.quality.topTags[0]).toEqual({ name: 'churn', count: 2 });

    const sources = Object.fromEntries(board.sources.map((x) => [x.name, x.count]));
    expect(sources).toEqual({ reddit: 1, hackernews: 1 });
    expect(board.sources.every((s) => s.verifiedRate === null)).toBe(true);

    // 趋势：密集 30 点，今日新增 2，窗口内总和 2
    expect(board.funnelTrend).toHaveLength(30);
    expect(board.funnelTrend.reduce((s, p) => s + p.insights, 0)).toBe(2);
    expect(board.funnelTrend.at(-1)?.insights).toBe(2);
  });

  it('按窗口过滤（since=now-7d）：窗口外的旧帖 / 旧洞察不计入', async () => {
    const now = nowSec();
    const old = now - 100 * 86_400; // 100 天前，落在 7 天窗口外
    await seedPost('old', 'reddit', { at: old, analyzed: true });
    await seedInsight('old', 'reddit', 'LOW', ['legacy'], old);
    await seedPost('new', 'reddit', { analyzed: true });
    await seedInsight('new', 'reddit', 'HIGH', ['fresh'], now);

    const board = await stats.getBoard(now - 7 * 86_400, 7);

    // 仅窗口内的 new 计入
    expect(board.funnel).toEqual({ collected: 1, analyzed: 1, insights: 1 });
    expect(board.quality.byIntensity).toEqual([{ name: 'HIGH', count: 1 }]);
    expect(board.quality.topTags).toEqual([{ name: 'fresh', count: 1 }]);
    expect(board.sources).toEqual([{ name: 'reddit', count: 1, verifiedRate: null }]);
    expect(board.funnelTrend).toHaveLength(7);
  });
});
