import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@/database';
import { RequestLanesRepository, RequestQueueRepository } from '@/database';
import { nowSec } from '@/utils/time';
import { RequestGate } from '@/modules/worker/request-gate';
import { setupTestDb, truncateAll } from './helpers';

/**
 * 出站请求闸闭环测试：经闸执行记一条 request_queue 行（done/failed）+ 自动建 lane；
 * lane 暂停时阻塞放行（超时放弃、fn 不执行），恢复后正常执行。仓储真连 PG，节流参数用短值快测。
 */
describe('出站请求闸（RequestGate：记录 / 失败 / 暂停）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let queue: RequestQueueRepository;
  let lanes: RequestLanesRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    queue = new RequestQueueRepository(db);
    lanes = new RequestLanesRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('run：执行 fn 并记一条 done 请求 + 自动建 lane', async () => {
    const gate = new RequestGate(queue, lanes);
    const out = await gate.run({ lane: 'reddit', purpose: 'listing', url: 'r/SaaS/hot' }, () =>
      Promise.resolve('ok'),
    );
    expect(out).toBe('ok');
    const recent = await queue.listRecent(10);
    expect(recent[0]).toMatchObject({ lane: 'reddit', purpose: 'listing', status: 'done' });
    expect((await lanes.listLanes()).some((l) => l.lane === 'reddit')).toBe(true);
  });

  it('run：fn 抛错记 failed 并冒泡', async () => {
    const gate = new RequestGate(queue, lanes);
    await expect(
      gate.run({ lane: 'reddit', purpose: 'comments' }, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    const recent = await queue.listRecent(10);
    expect(recent[0]?.status).toBe('failed');
    expect(recent[0]?.error).toContain('boom');
  });

  it('run：lane 暂停时阻塞、超时放弃（fn 不执行）；恢复后正常执行', async () => {
    const gate = new RequestGate(queue, lanes, { pausePollMs: 20, maxPauseWaitMs: 60 });
    await lanes.setPaused('reddit', true, nowSec());
    let ran = false;
    await expect(
      gate.run({ lane: 'reddit', purpose: 'listing' }, () => {
        ran = true;

        return Promise.resolve('x');
      }),
    ).rejects.toThrow(/暂停/);
    expect(ran).toBe(false);

    await lanes.setPaused('reddit', false, nowSec());
    expect(await gate.run({ lane: 'reddit', purpose: 'listing' }, () => Promise.resolve('y'))).toBe(
      'y',
    );
  });
});
