import type { PostProcessor } from './analyzer/analyze';
import { getCommentsForPost } from './db/comments';
import {
  claimNextJob,
  failJob,
  getJobStats,
  reclaimRunningJobs,
  succeedJob,
  touchHeartbeat,
  type JobRow,
} from './db/jobs';
import { bumpAnalyzeAttempts, getPostById, markAnalyzed } from './db/posts';
import { nowSec } from './db/utils';
import { logger } from './logger';

/** 默认并发 worker 数（M3 起可由 app_settings.worker_concurrency 覆盖） */
const DEFAULT_CONCURRENCY = 2;
/** 队列为空时的轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 2000;
/** running 期间的心跳间隔（毫秒），需远小于 STALE_SECONDS */
const HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * 单个 job 的硬超时（毫秒）。设得高于 provider 自身重试上限（每次 120s × 数次），
 * 仅作真正卡死的兜底——正常调用会先被 provider 的 AbortController 中止。
 */
const JOB_TIMEOUT_MS = 600_000;
/** running 心跳早于 now-STALE_SECONDS 视为僵死 */
const STALE_SECONDS = 300;
/** 周期性僵死回收间隔（毫秒） */
const RECLAIM_INTERVAL_MS = 60_000;

/** 运行中的 worker 池句柄 */
export interface WorkerPool {
  /** 优雅停止：停止认领新任务，等待在途任务跑完 */
  stop(): Promise<void>;
}

/** startWorkerPool 选项 */
export interface WorkerOptions {
  /**
   * 按 job 解析处理器：依据 job.provider_id 从库取配置、解密密钥并构建处理器。
   * 返回 null（配置不存在/停用/解密失败/无 provider）时该任务判失败，不影响其余任务。
   */
  resolveProcessor: (job: JobRow) => PostProcessor | null;
  /** 并发 worker 数，默认 {@link DEFAULT_CONCURRENCY} */
  concurrency?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 给 Promise 加超时兜底。竞速失败的一方仍会被 Promise.race 内部消费，
 * 不会产生 unhandledRejection；但底层调用不会因此被取消（由 provider 自身的超时中止）。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`job 处理超时（>${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 启动分析 worker 池：固定并发地从 analysis_jobs 队列认领任务并执行。
 *
 * 不卡死的几道保障：
 * - 队列持久化在 SQLite，进程重启可续跑；启动即回收上次遗留的 running（孤儿）任务
 * - 每个 job 带 {@link JOB_TIMEOUT_MS} 硬超时，叠加 provider 自身的请求超时
 * - running 期间打心跳，周期回收心跳超时的僵死任务（崩溃循环受 max_attempts 保护）
 *
 * @param opts 处理器与并发度
 * @returns 可优雅停止的池句柄
 */
export function startWorkerPool(opts: WorkerOptions): WorkerPool {
  const { resolveProcessor } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  let stopping = false;

  async function runJob(job: JobRow): Promise<void> {
    const post = getPostById(job.post_id);
    if (!post) {
      failJob(job.id, '帖子不存在或已归档', nowSec());
      return;
    }
    const processor = resolveProcessor(job);
    if (!processor) {
      // 配置问题（非帖子问题）：不递增 posts.analyze_attempts，修好配置后下轮可重试
      failJob(
        job.id,
        `无法解析模型配置（provider_id=${job.provider_id ?? 'null'}），请检查设置`,
        nowSec(),
      );
      return;
    }
    const comments = getCommentsForPost(job.post_id);
    const heartbeat = setInterval(() => touchHeartbeat(job.id, nowSec()), HEARTBEAT_INTERVAL_MS);
    try {
      const { saved } = await withTimeout(processor.process(post, comments), JOB_TIMEOUT_MS);
      markAnalyzed(post.id, nowSec());
      succeedJob(job.id, nowSec());
      if (saved) {
        logger.info(`  ✓ [job#${job.id}] r/${post.subreddit}「${post.title.slice(0, 40)}」已落库`);
      }
    } catch (err) {
      bumpAnalyzeAttempts(post.id);
      const msg = err instanceof Error ? err.message : String(err);
      failJob(job.id, msg, nowSec());
      logger.error(`  ✗ [job#${job.id}] ${post.id} 失败: ${msg}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function loop(): Promise<void> {
    while (!stopping) {
      const job = claimNextJob(nowSec());
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      // runJob 内部已兜底异常；此处再加一层，确保单条意外永不拖垮 worker 循环
      try {
        await runJob(job);
      } catch (err) {
        logger.error(
          `[worker] runJob 未捕获异常: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 启动即回收上次进程遗留的 running 任务（进程被杀时它们停在 running）
  const orphaned = reclaimRunningJobs(nowSec(), null);
  if (orphaned > 0) logger.warn(`[worker] 启动回收 ${orphaned} 个遗留 running 任务`);

  const reclaimTimer = setInterval(() => {
    const reclaimed = reclaimRunningJobs(nowSec(), STALE_SECONDS);
    if (reclaimed > 0)
      logger.warn(`[worker] 回收 ${reclaimed} 个僵死任务（心跳超 ${STALE_SECONDS}s）`);
  }, RECLAIM_INTERVAL_MS);

  const loops = Array.from({ length: concurrency }, () => loop());
  const stats = getJobStats();
  logger.info(
    `[worker] 分析 worker 池已启动（并发 ${concurrency}）；当前队列 queued ${stats.queued} / running ${stats.running}`,
  );

  return {
    async stop() {
      stopping = true;
      clearInterval(reclaimTimer);
      await Promise.allSettled(loops);
    },
  };
}
