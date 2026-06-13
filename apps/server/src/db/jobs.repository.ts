import { Inject, Injectable } from '@nestjs/common';
import { toJobRow, type AppDatabase, type JobPg, type JobRow, type Prisma } from '@hatch-radar/db';
import { PRISMA } from '../common/tokens';

/** 任务触发来源：auto=定时调度入队，manual=管理员在工作台手动入队 */
export type JobTrigger = JobRow['trigger'];
/** 任务状态机：queued → running →（succeeded | failed）；queued 可被取消为 canceled */
export type JobStatus = JobRow['status'];
export type { JobRow };

/** 新任务默认的最大尝试次数（仅用于僵死/崩溃循环保护，正常失败即终态） */
const DEFAULT_MAX_ATTEMPTS = 3;
/** 错误信息落库长度上限，避免异常堆栈撑爆字段 */
const MAX_ERROR_CHARS = 500;

/** 队列看板行：任务字段 + 帖子标题（左连接，帖子归档后为 null） */
export interface JobView {
  id: number;
  post_id: string;
  post_title: string | null;
  model: string;
  trigger: JobTrigger;
  status: JobStatus;
  attempts: number;
  error: string | null;
  enqueued_at: number;
  started_at: number | null;
  finished_at: number | null;
}

/** listRecentJobs 的原始行（时间戳为 bigint，待折回 number） */
type JobViewRaw = Omit<JobView, 'enqueued_at' | 'started_at' | 'finished_at'> & {
  enqueued_at: bigint;
  started_at: bigint | null;
  finished_at: bigint | null;
};

/**
 * 分析任务队列数据访问（Prisma / PostgreSQL）。
 *
 * 认领用 `FOR UPDATE SKIP LOCKED`（Prisma 无一等 API → $queryRaw）：多 worker / 多进程并发
 * 认领互不冲突、不重不漏，同时解锁「worker 独立成进程」。心跳 / 僵死回收 / max_attempts 原样保留。
 */
@Injectable()
export class JobsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 批量入队分析任务。
   * - 幂等去重：同一帖子已有 queued / running 任务时跳过，避免重复入队
   * - 任务携带 model 快照与 provider_id（软引用），便于 worker 落库与溯源
   * @param postIds 目标帖子 ID 列表
   * @param providerId 使用的模型配置 ID
   * @param model 模型 ID 快照
   * @param trigger 触发来源（auto / manual）
   * @param now 入队 Unix 时间戳（秒）
   * @returns 实际新入队的任务数
   */
  async enqueueJobs(
    postIds: string[],
    providerId: number | null,
    model: string,
    trigger: JobTrigger,
    now: number,
  ): Promise<number> {
    const unique = [...new Set(postIds)];
    if (unique.length === 0) return 0;
    return this.db.$transaction(async (tx) => {
      const active = await tx.analysis_jobs.findMany({
        where: { post_id: { in: unique }, status: { in: ['queued', 'running'] } },
        select: { post_id: true },
      });
      const activeSet = new Set(active.map((r) => r.post_id));
      const toInsert = unique.filter((id) => !activeSet.has(id));
      if (toInsert.length === 0) return 0;
      await tx.analysis_jobs.createMany({
        data: toInsert.map((post_id) => ({
          post_id,
          provider_id: providerId,
          model,
          trigger,
          status: 'queued' as const,
          attempts: 0,
          max_attempts: DEFAULT_MAX_ATTEMPTS,
          enqueued_at: BigInt(now),
        })),
      });
      return toInsert.length;
    });
  }

  /**
   * 原子认领下一条待处理任务：取最老的 queued，置为 running 并 +1 尝试次数。
   * - `FOR UPDATE SKIP LOCKED`：并发认领跳过已被他人锁定的行，绝不认领到同一条
   * @param now 当前 Unix 时间戳（秒）
   * @returns 认领到的任务（已更新为 running）；队列为空时返回 null
   */
  async claimNextJob(now: number): Promise<JobRow | null> {
    return this.db.$transaction(async (tx) => {
      const picked = await tx.$queryRaw<JobPg[]>`
        SELECT * FROM analysis_jobs
        WHERE status = 'queued'
        ORDER BY enqueued_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const job = picked[0];
      if (!job) return null;
      await tx.analysis_jobs.update({
        where: { id: job.id },
        data: {
          status: 'running',
          started_at: BigInt(now),
          heartbeat_at: BigInt(now),
          attempts: { increment: 1 },
        },
      });
      return toJobRow({
        ...job,
        status: 'running',
        started_at: BigInt(now),
        heartbeat_at: BigInt(now),
        attempts: job.attempts + 1,
      });
    });
  }

  /**
   * 更新 running 任务的心跳时间（worker 处理期间周期调用，避免长任务被误判僵死）。
   * @param jobId 任务 ID
   * @param now 当前 Unix 时间戳（秒）
   */
  async touchHeartbeat(jobId: number, now: number): Promise<void> {
    await this.db.analysis_jobs.updateMany({
      where: { id: jobId, status: 'running' },
      data: { heartbeat_at: BigInt(now) },
    });
  }

  /**
   * 标记任务成功。
   * @param jobId 任务 ID
   * @param now 完成 Unix 时间戳（秒）
   */
  async succeedJob(jobId: number, now: number): Promise<void> {
    await this.db.analysis_jobs.update({
      where: { id: jobId },
      data: { status: 'succeeded', finished_at: BigInt(now), error: null },
    });
  }

  /**
   * 标记任务失败（终态）。
   * @param jobId 任务 ID
   * @param error 失败原因（截断存储）
   * @param now 完成 Unix 时间戳（秒）
   */
  async failJob(jobId: number, error: string, now: number): Promise<void> {
    await this.db.analysis_jobs.update({
      where: { id: jobId },
      data: { status: 'failed', finished_at: BigInt(now), error: error.slice(0, MAX_ERROR_CHARS) },
    });
  }

  /**
   * 回收 running 任务：心跳超时（或进程重启后遗留）的任务被认定为僵死。
   * - 未超 max_attempts 的回 queued 重排（清空 started_at / heartbeat_at），否则判失败
   * @param now 当前 Unix 时间戳（秒）
   * @param staleSeconds 心跳早于 `now - staleSeconds` 才回收；传 null 回收全部 running（进程启动时用）
   * @returns 被回收的任务数
   */
  async reclaimRunningJobs(now: number, staleSeconds: number | null): Promise<number> {
    const where: Prisma.analysis_jobsWhereInput =
      staleSeconds === null
        ? { status: 'running' }
        : {
            status: 'running',
            OR: [{ heartbeat_at: null }, { heartbeat_at: { lt: BigInt(now - staleSeconds) } }],
          };
    return this.db.$transaction(async (tx) => {
      const rows = await tx.analysis_jobs.findMany({
        where,
        select: { id: true, attempts: true, max_attempts: true },
      });
      if (rows.length === 0) return 0;
      for (const r of rows) {
        if (r.attempts >= r.max_attempts) {
          await tx.analysis_jobs.update({
            where: { id: r.id },
            data: {
              status: 'failed',
              finished_at: BigInt(now),
              error: '僵死回收：超过最大尝试次数',
            },
          });
        } else {
          await tx.analysis_jobs.update({
            where: { id: r.id },
            data: { status: 'queued', started_at: null, heartbeat_at: null },
          });
        }
      }
      return rows.length;
    });
  }

  /** 各状态任务数汇总，用于启动 / worker 日志与队列看板 */
  async getJobStats(): Promise<Record<JobStatus, number>> {
    const rows = await this.db.analysis_jobs.groupBy({ by: ['status'], _count: { _all: true } });
    const stats: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    };
    for (const r of rows) stats[r.status] = r._count._all;
    return stats;
  }

  /** 取最近的任务（按 id 倒序），供 web 队列看板轮询展示 */
  async listRecentJobs(limit: number): Promise<JobView[]> {
    const rows = await this.db.$queryRaw<JobViewRaw[]>`
      SELECT j.id, j.post_id, p.title AS post_title, j.model, j.trigger, j.status,
             j.attempts, j.error, j.enqueued_at, j.started_at, j.finished_at
      FROM analysis_jobs j
      LEFT JOIN posts p ON p.id = j.post_id
      ORDER BY j.id DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      ...r,
      enqueued_at: Number(r.enqueued_at),
      started_at: r.started_at === null ? null : Number(r.started_at),
      finished_at: r.finished_at === null ? null : Number(r.finished_at),
    }));
  }
}
