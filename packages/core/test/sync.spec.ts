import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, type AppDatabase, type DbHandle } from '@hatch-radar/db';
import { SyncService } from '@/sync/sync.service';
import { nowSec } from '@hatch-radar/kernel';
import { setupTestDb, truncateAll } from './helpers';

/** 插入一条洞察并返回其 id（作为同步操作的 targetId） */
async function seedInsight(db: AppDatabase): Promise<number> {
  const row = await db.insights.create({
    data: {
      post_id: `p-${Math.floor(nowSec())}-${Math.round(performance.now())}`,
      source: 'reddit',
      subreddit: 'SaaS',
      post_title: 't',
      permalink: null,
      model: 'm',
      intensity: 'HIGH',
      pain_points: [
        { description: 'd', evidence: 'e', intensity: 'HIGH' },
      ] as Prisma.InputJsonValue,
      opportunities: [] as Prisma.InputJsonValue,
      tags: ['x'] as Prisma.InputJsonValue,
      created_at: BigInt(nowSec()),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * 同步幂等核心：op_id 重放只应用一次（第二次 duplicate）；目标不存在 → rejected，
 * 且不阻塞同批其余操作。
 */
describe('SyncService（按 op_id 幂等应用）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let sync: SyncService;

  beforeAll(async () => {
    handle = setupTestDb();
    db = handle.db;
    sync = new SyncService(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('同一 op_id 重放只应用一次', async () => {
    const targetId = await seedInsight(db);
    const op = {
      opId: 'op-1',
      type: 'set_status',
      targetId,
      payload: { status: 'shortlisted' },
      createdAt: nowSec(),
    };

    const r1 = await sync.applySyncPush('device-aaaa', [op]);
    expect(r1.results[0].outcome).toBe('applied');

    const r2 = await sync.applySyncPush('device-aaaa', [op]);
    expect(r2.results[0].outcome).toBe('duplicate');

    const row = await db.triage.findUnique({ where: { insight_id: targetId } });
    expect(row?.status).toBe('shortlisted');
    // sync_ops 仅一条留痕
    const ops = await db.sync_ops.findMany();
    expect(ops).toHaveLength(1);
  });

  it('目标洞察不存在 → rejected，不影响同批其它操作', async () => {
    const targetId = await seedInsight(db);
    const res = await sync.applySyncPush('device-bbbb', [
      {
        opId: 'op-good',
        type: 'set_rating',
        targetId,
        payload: { rating: 4 },
        createdAt: nowSec(),
      },
      {
        opId: 'op-bad',
        type: 'set_status',
        targetId: 999_999,
        payload: { status: 'archived' },
        createdAt: nowSec(),
      },
    ]);
    expect(res.results[0].outcome).toBe('applied');
    expect(res.results[1].outcome).toBe('rejected');

    const row = await db.triage.findUnique({ where: { insight_id: targetId } });
    expect(row?.rating).toBe(4);
  });

  it('set_tags 覆盖写入 jsonb 数组', async () => {
    const targetId = await seedInsight(db);
    await sync.applySyncPush('device-cccc', [
      {
        opId: 'op-tags',
        type: 'set_tags',
        targetId,
        payload: { tags: ['效率', '协作'] },
        createdAt: nowSec(),
      },
    ]);
    const row = await db.triage.findUnique({ where: { insight_id: targetId } });
    expect(row?.tags).toEqual(['效率', '协作']);
  });

  it('payload 非法 → rejected（协议校验）', async () => {
    const res = await sync.applySyncPush('device-dddd', [
      {
        opId: 'op-bad-rating',
        type: 'set_rating',
        targetId: 1,
        payload: { rating: 9 },
        createdAt: nowSec(),
      },
    ]);
    expect(res.results[0].outcome).toBe('rejected');
  });
});
