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

  it('deleteFinishedJobsBefore 只删早于 cutoff 的终态任务，保留 queued/running 与较新终态', async () => {
    // 旧的 succeeded（finished_at=1000）
    await jobs.enqueueJobs(['old1'], 1, 'm', 'auto', 1000);
    const j1 = await jobs.claimNextJob(1000);
    await jobs.succeedJob(j1!.id, 1000);
    // 新的 failed（finished_at=5000）
    await jobs.enqueueJobs(['new1'], 1, 'm', 'auto', 5000);
    const j2 = await jobs.claimNextJob(5000);
    await jobs.failJob(j2!.id, 'e', 5000);
    // queued（无 finished_at，不应被删）
    await jobs.enqueueJobs(['q1'], 1, 'm', 'auto', 5000);

    const deleted = await jobs.deleteFinishedJobsBefore(3000);
    expect(deleted).toBe(1); // 仅 old1
    const stats = await jobs.getJobStats();
    expect(stats.succeeded).toBe(0); // old1 已清
    expect(stats.failed).toBe(1); // new1 保留（finished_at 较新）
    expect(stats.queued).toBe(1); // q1 保留
  });

  it('部分唯一索引兜底：绕过预检查直插第二条活跃任务会被拒（并发竞态保护）', async () => {
    const t = nowSec();
    await jobs.enqueueJobs(['p1'], 1, 'm', 'auto', t);
    // 模拟两个入队事务都通过了预检查、第二条才落库的竞态：直插应撞 uniq_jobs_active_post
    await expect(
      db.analysis_jobs.create({
        data: {
          post_id: 'p1',
          provider_id: 1,
          model: 'm',
          trigger: 'auto',
          status: 'queued',
          attempts: 0,
          max_attempts: 3,
          enqueued_at: BigInt(t),
        },
      }),
    ).rejects.toThrow();
    const stats = await jobs.getJobStats();
    expect(stats.queued).toBe(1); // 仍只有一条活跃任务
  });

  it('帖子任务进入终态后可再次入队（部分唯一索引只约束活跃态）', async () => {
    const t = nowSec();
    await jobs.enqueueJobs(['p1'], 1, 'm', 'auto', t);
    const j = await jobs.claimNextJob(t);
    await jobs.failJob(j!.id, 'boom', t);
    // 上一条已 failed（非活跃态）→ 同帖可重新入队，索引不阻挡
    expect(await jobs.enqueueJobs(['p1'], 1, 'm', 'auto', t)).toBe(1);
    const stats = await jobs.getJobStats();
    expect(stats.failed).toBe(1);
    expect(stats.queued).toBe(1);
  });
});
