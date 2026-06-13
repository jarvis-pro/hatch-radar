import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import { JobsRepository } from '../src/db/jobs.repository';
import { nowSec } from '../src/common/time';
import { setupTestDb, truncateAll } from './helpers';

/**
 * 队列正确性核心：FOR UPDATE SKIP LOCKED 认领并发不重复、不丢任务；入队按帖子幂等去重；
 * 僵死回收按 max_attempts 重排/判失败。
 */
describe('JobsRepository（队列并发认领 / 幂等入队 / 僵死回收）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let jobs: JobsRepository;

  beforeAll(async () => {
    handle = await setupTestDb();
    db = handle.db;
    jobs = new JobsRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('单条 queued 任务在多个并发认领者中只被一人拿到', async () => {
    await jobs.enqueueJobs(['p1'], 1, 'm', 'auto', nowSec());
    const results = await Promise.all(Array.from({ length: 8 }, () => jobs.claimNextJob(nowSec())));
    const claimed = results.filter((r) => r !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.post_id).toBe('p1');
    expect(claimed[0]!.status).toBe('running');
    expect(claimed[0]!.attempts).toBe(1);
  });

  it('N 条任务被 N 个并发认领者瓜分，无重复、无遗漏', async () => {
    const N = 40;
    const ids = Array.from({ length: N }, (_, i) => `post-${i}`);
    const enqueued = await jobs.enqueueJobs(ids, 1, 'm', 'auto', nowSec());
    expect(enqueued).toBe(N);

    const results = await Promise.all(Array.from({ length: N }, () => jobs.claimNextJob(nowSec())));
    const claimedIds = results.filter((r) => r !== null).map((r) => r!.id);
    // 无重复：去重后数量不变
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    // 无遗漏：N 条全部被认领
    expect(claimedIds.length).toBe(N);

    const stats = await jobs.getJobStats();
    expect(stats.queued).toBe(0);
    expect(stats.running).toBe(N);
  });

  it('队列为空时认领返回 null', async () => {
    expect(await jobs.claimNextJob(nowSec())).toBeNull();
  });

  it('同一帖子已有 queued/running 任务时不重复入队', async () => {
    const t = nowSec();
    expect(await jobs.enqueueJobs(['p1', 'p2'], 1, 'm', 'auto', t)).toBe(2);
    // p1/p2 已在队列；仅 p3 应新入队
    expect(await jobs.enqueueJobs(['p1', 'p2', 'p3'], 1, 'm', 'auto', t)).toBe(1);
    // running 状态同样阻止重复入队
    await jobs.claimNextJob(t);
    expect(await jobs.enqueueJobs(['p1', 'p2', 'p3'], 1, 'm', 'auto', t)).toBe(0);
  });

  it('僵死 running 任务在未超 max_attempts 时被回 queued 重排', async () => {
    const t = 1_000_000;
    await jobs.enqueueJobs(['p1'], 1, 'm', 'auto', t);
    const job = await jobs.claimNextJob(t);
    expect(job!.attempts).toBe(1);

    // 心跳停在 t；staleSeconds=300，now=t+1000 → 判定僵死
    const reclaimed = await jobs.reclaimRunningJobs(t + 1000, 300);
    expect(reclaimed).toBe(1);
    const stats = await jobs.getJobStats();
    expect(stats.queued).toBe(1);
    expect(stats.running).toBe(0);
  });

  it('僵死 running 任务超过 max_attempts 时判失败', async () => {
    const t = 2_000_000;
    await jobs.enqueueJobs(['p1'], 1, 'm', 'auto', t);
    // 认领 3 次（默认 max_attempts=3）：每次回收→重排→再认领，attempts 累加到 3
    await jobs.claimNextJob(t);
    await jobs.reclaimRunningJobs(t + 1000, null);
    await jobs.claimNextJob(t);
    await jobs.reclaimRunningJobs(t + 1000, null);
    const third = await jobs.claimNextJob(t);
    expect(third!.attempts).toBe(3);

    const reclaimed = await jobs.reclaimRunningJobs(t + 1000, null);
    expect(reclaimed).toBe(1);
    const stats = await jobs.getJobStats();
    expect(stats.failed).toBe(1);
    expect(stats.queued).toBe(0);
    expect(stats.running).toBe(0);
  });
});
