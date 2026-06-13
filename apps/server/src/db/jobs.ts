import { getDb } from './schema';

/** 任务触发来源：auto=定时调度入队，manual=管理员在工作台手动入队 */
export type JobTrigger = 'auto' | 'manual';

/** 任务状态机：queued → running →（succeeded | failed）；queued 可被取消为 canceled */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

/** analysis_jobs 表的行结构 */
export interface JobRow {
  id: number;
  post_id: string;
  /** 使用哪条 model_providers（软引用）；M2 暂为 null，M3 起按 active/手动选择填入 */
  provider_id: number | null;
  /** 模型 ID 快照，落库到 insights.model */
  model: string;
  trigger: JobTrigger;
  status: JobStatus;
  /** 已执行次数（每次认领 +1），用于僵死回收的崩溃循环保护 */
  attempts: number;
  max_attempts: number;
  error: string | null;
  enqueued_at: number;
  started_at: number | null;
  finished_at: number | null;
  /** running 期间的心跳；超阈值视为僵死，由 reclaimRunningJobs 回收 */
  heartbeat_at: number | null;
}

/** 新任务默认的最大尝试次数（仅用于僵死/崩溃循环保护，正常失败即终态） */
const DEFAULT_MAX_ATTEMPTS = 3;

/** 错误信息落库长度上限，避免异常堆栈撑爆字段 */
const MAX_ERROR_CHARS = 500;

/**
 * 批量入队分析任务。
 * - 幂等去重：同一帖子已有 queued / running 任务时跳过，避免重复入队
 * - 任务携带 model 快照与 provider_id（软引用），便于 worker 落库与溯源
 * @param postIds 目标帖子 ID 列表
 * @param providerId 使用的模型配置 ID（M2 传 null，由 env 解析的单一处理器执行）
 * @param model 模型 ID 快照
 * @param trigger 触发来源（auto / manual）
 * @param now 入队 Unix 时间戳（秒）
 * @returns 实际新入队的任务数
 */
export function enqueueJobs(
  postIds: string[],
  providerId: number | null,
  model: string,
  trigger: JobTrigger,
  now: number,
): number {
  if (postIds.length === 0) return 0;
  const db = getDb();
  const hasActive = db.prepare(
    `SELECT 1 FROM analysis_jobs WHERE post_id = ? AND status IN ('queued', 'running') LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO analysis_jobs (post_id, provider_id, model, trigger, status, attempts, max_attempts, enqueued_at)
     VALUES (?, ?, ?, ?, 'queued', 0, ?, ?)`,
  );
  let n = 0;
  db.transaction(() => {
    for (const postId of postIds) {
      if (hasActive.get(postId)) continue;
      insert.run(postId, providerId, model, trigger, DEFAULT_MAX_ATTEMPTS, now);
      n++;
    }
  })();
  return n;
}

/**
 * 原子认领下一条待处理任务：取最老的 queued，置为 running 并 +1 尝试次数。
 * - 在 better-sqlite3 的同步事务内完成「查 + 改」，单进程内多 worker 不会认领到同一条
 * @param now 当前 Unix 时间戳（秒）
 * @returns 认领到的任务（已更新为 running）；队列为空时返回 null
 */
export function claimNextJob(now: number): JobRow | null {
  const db = getDb();
  return db.transaction((): JobRow | null => {
    const job = db
      .prepare(
        `SELECT * FROM analysis_jobs WHERE status = 'queued' ORDER BY enqueued_at, id LIMIT 1`,
      )
      .get() as JobRow | undefined;
    if (!job) return null;
    db.prepare(
      `UPDATE analysis_jobs SET status = 'running', started_at = ?, heartbeat_at = ?, attempts = attempts + 1 WHERE id = ?`,
    ).run(now, now, job.id);
    return {
      ...job,
      status: 'running',
      started_at: now,
      heartbeat_at: now,
      attempts: job.attempts + 1,
    };
  })();
}

/**
 * 更新 running 任务的心跳时间（worker 处理期间周期调用，避免长任务被误判僵死）。
 * @param jobId 任务 ID
 * @param now 当前 Unix 时间戳（秒）
 */
export function touchHeartbeat(jobId: number, now: number): void {
  getDb()
    .prepare(`UPDATE analysis_jobs SET heartbeat_at = ? WHERE id = ? AND status = 'running'`)
    .run(now, jobId);
}

/**
 * 标记任务成功。
 * @param jobId 任务 ID
 * @param now 完成 Unix 时间戳（秒）
 */
export function succeedJob(jobId: number, now: number): void {
  getDb()
    .prepare(
      `UPDATE analysis_jobs SET status = 'succeeded', finished_at = ?, error = NULL WHERE id = ?`,
    )
    .run(now, jobId);
}

/**
 * 标记任务失败（终态）。
 * - 自动任务的下一轮 cron 会按 getPostsToAnalyze 重新入队（受 posts.analyze_attempts<3 约束）
 * @param jobId 任务 ID
 * @param error 失败原因（截断存储）
 * @param now 完成 Unix 时间戳（秒）
 */
export function failJob(jobId: number, error: string, now: number): void {
  getDb()
    .prepare(`UPDATE analysis_jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`)
    .run(now, error.slice(0, MAX_ERROR_CHARS), jobId);
}

/**
 * 回收 running 任务：心跳超时（或进程重启后遗留）的任务被认定为僵死。
 * - 未超 max_attempts 的回 queued 重排（清空 started_at / heartbeat_at），否则判失败
 * @param now 当前 Unix 时间戳（秒）
 * @param staleSeconds 心跳早于 `now - staleSeconds` 才回收；传 null 回收全部 running（进程启动时用）
 * @returns 被回收的任务数
 */
export function reclaimRunningJobs(now: number, staleSeconds: number | null): number {
  const db = getDb();
  const where =
    staleSeconds === null
      ? `status = 'running'`
      : `status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ${now - staleSeconds})`;
  const rows = db
    .prepare(`SELECT id, attempts, max_attempts FROM analysis_jobs WHERE ${where}`)
    .all() as { id: number; attempts: number; max_attempts: number }[];
  if (rows.length === 0) return 0;
  const requeue = db.prepare(
    `UPDATE analysis_jobs SET status = 'queued', started_at = NULL, heartbeat_at = NULL WHERE id = ?`,
  );
  const fail = db.prepare(
    `UPDATE analysis_jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`,
  );
  db.transaction(() => {
    for (const r of rows) {
      if (r.attempts >= r.max_attempts) {
        fail.run(now, '僵死回收：超过最大尝试次数', r.id);
      } else {
        requeue.run(r.id);
      }
    }
  })();
  return rows.length;
}

/** 各状态任务数汇总，用于启动 / worker 日志与队列看板 */
export function getJobStats(): Record<JobStatus, number> {
  const rows = getDb()
    .prepare(`SELECT status, COUNT(*) n FROM analysis_jobs GROUP BY status`)
    .all() as { status: JobStatus; n: number }[];
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

/** 取最近的任务（按 id 倒序），供 web 队列看板轮询展示 */
export function listRecentJobs(limit: number): JobView[] {
  return getDb()
    .prepare(
      `SELECT j.id, j.post_id, p.title AS post_title, j.model, j.trigger, j.status,
              j.attempts, j.error, j.enqueued_at, j.started_at, j.finished_at
       FROM analysis_jobs j
       LEFT JOIN posts p ON p.id = j.post_id
       ORDER BY j.id DESC
       LIMIT ?`,
    )
    .all(limit) as JobView[];
}
