import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { analysisJobs, posts, type AppDatabase, type JobRow } from '@hatch-radar/db';
import { DRIZZLE } from '../common/tokens';

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

/**
 * 分析任务队列数据访问（异步 Drizzle / PostgreSQL）。
 *
 * 认领改用 `FOR UPDATE SKIP LOCKED`：多 worker / 多进程并发认领互不冲突、不重不漏，
 * 同时解锁「worker 独立成进程」。心跳 / 僵死回收 / max_attempts 逻辑原样保留。
 */
@Injectable()
export class JobsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: AppDatabase) {}

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
    return this.db.transaction(async (tx) => {
      const active = await tx
        .select({ post_id: analysisJobs.post_id })
        .from(analysisJobs)
        .where(
          and(
            inArray(analysisJobs.post_id, unique),
            inArray(analysisJobs.status, ['queued', 'running']),
          ),
        );
      const activeSet = new Set(active.map((r) => r.post_id));
      const toInsert = unique.filter((id) => !activeSet.has(id));
      if (toInsert.length === 0) return 0;
      await tx.insert(analysisJobs).values(
        toInsert.map((post_id) => ({
          post_id,
          provider_id: providerId,
          model,
          trigger,
          status: 'queued' as const,
          attempts: 0,
          max_attempts: DEFAULT_MAX_ATTEMPTS,
          enqueued_at: now,
        })),
      );
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
    return this.db.transaction(async (tx) => {
      const picked = await tx
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.status, 'queued'))
        .orderBy(asc(analysisJobs.enqueued_at), asc(analysisJobs.id))
        .limit(1)
        .for('update', { skipLocked: true });
      const job = picked[0];
      if (!job) return null;
      await tx
        .update(analysisJobs)
        .set({
          status: 'running',
          started_at: now,
          heartbeat_at: now,
          attempts: sql`${analysisJobs.attempts} + 1`,
        })
        .where(eq(analysisJobs.id, job.id));
      return {
        ...job,
        status: 'running' as const,
        started_at: now,
        heartbeat_at: now,
        attempts: job.attempts + 1,
      };
    });
  }

  /**
   * 更新 running 任务的心跳时间（worker 处理期间周期调用，避免长任务被误判僵死）。
   * @param jobId 任务 ID
   * @param now 当前 Unix 时间戳（秒）
   */
  async touchHeartbeat(jobId: number, now: number): Promise<void> {
    await this.db
      .update(analysisJobs)
      .set({ heartbeat_at: now })
      .where(and(eq(analysisJobs.id, jobId), eq(analysisJobs.status, 'running')));
  }

  /**
   * 标记任务成功。
   * @param jobId 任务 ID
   * @param now 完成 Unix 时间戳（秒）
   */
  async succeedJob(jobId: number, now: number): Promise<void> {
    await this.db
      .update(analysisJobs)
      .set({ status: 'succeeded', finished_at: now, error: null })
      .where(eq(analysisJobs.id, jobId));
  }

  /**
   * 标记任务失败（终态）。
   * @param jobId 任务 ID
   * @param error 失败原因（截断存储）
   * @param now 完成 Unix 时间戳（秒）
   */
  async failJob(jobId: number, error: string, now: number): Promise<void> {
    await this.db
      .update(analysisJobs)
      .set({ status: 'failed', finished_at: now, error: error.slice(0, MAX_ERROR_CHARS) })
      .where(eq(analysisJobs.id, jobId));
  }

  /**
   * 回收 running 任务：心跳超时（或进程重启后遗留）的任务被认定为僵死。
   * - 未超 max_attempts 的回 queued 重排（清空 started_at / heartbeat_at），否则判失败
   * @param now 当前 Unix 时间戳（秒）
   * @param staleSeconds 心跳早于 `now - staleSeconds` 才回收；传 null 回收全部 running（进程启动时用）
   * @returns 被回收的任务数
   */
  async reclaimRunningJobs(now: number, staleSeconds: number | null): Promise<number> {
    const staleCond =
      staleSeconds === null
        ? sql`${analysisJobs.status} = 'running'`
        : sql`${analysisJobs.status} = 'running' AND (${analysisJobs.heartbeat_at} IS NULL OR ${analysisJobs.heartbeat_at} < ${now - staleSeconds})`;
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: analysisJobs.id,
          attempts: analysisJobs.attempts,
          max_attempts: analysisJobs.max_attempts,
        })
        .from(analysisJobs)
        .where(staleCond);
      if (rows.length === 0) return 0;
      for (const r of rows) {
        if (r.attempts >= r.max_attempts) {
          await tx
            .update(analysisJobs)
            .set({ status: 'failed', finished_at: now, error: '僵死回收：超过最大尝试次数' })
            .where(eq(analysisJobs.id, r.id));
        } else {
          await tx
            .update(analysisJobs)
            .set({ status: 'queued', started_at: null, heartbeat_at: null })
            .where(eq(analysisJobs.id, r.id));
        }
      }
      return rows.length;
    });
  }

  /** 各状态任务数汇总，用于启动 / worker 日志与队列看板 */
  async getJobStats(): Promise<Record<JobStatus, number>> {
    const rows = await this.db
      .select({ status: analysisJobs.status, n: sql<number>`count(*)::int` })
      .from(analysisJobs)
      .groupBy(analysisJobs.status);
    const stats: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    };
    for (const r of rows) stats[r.status] = r.n;
    return stats;
  }

  /** 取最近的任务（按 id 倒序），供 web 队列看板轮询展示 */
  listRecentJobs(limit: number): Promise<JobView[]> {
    return this.db
      .select({
        id: analysisJobs.id,
        post_id: analysisJobs.post_id,
        post_title: posts.title,
        model: analysisJobs.model,
        trigger: analysisJobs.trigger,
        status: analysisJobs.status,
        attempts: analysisJobs.attempts,
        error: analysisJobs.error,
        enqueued_at: analysisJobs.enqueued_at,
        started_at: analysisJobs.started_at,
        finished_at: analysisJobs.finished_at,
      })
      .from(analysisJobs)
      .leftJoin(posts, eq(posts.id, analysisJobs.post_id))
      .orderBy(desc(analysisJobs.id))
      .limit(limit);
  }
}
