import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AnalysisConfigService } from '../analysis/analysis-config.service';
import { AnalysisService } from '../analysis/analysis.service';
import { APP_ENV } from '../common/tokens';
import { nowSec } from '../common/time';
import type { AppEnv } from '../config/env';
import { CommentsRepository } from '../db/comments.repository';
import { JobsRepository, type JobRow } from '../db/jobs.repository';
import { PostsRepository } from '../db/posts.repository';
import { logger } from '../logger';

// 并发数 / job 超时 / 僵死阈值已移到 env（见 AppEnv.worker），可按部署调整；以下为不随部署变的内部常量。
/** 队列为空时的轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 2000;
/** running 期间的心跳间隔（毫秒），需远小于 env.worker.staleSeconds */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** 周期性僵死回收间隔（毫秒） */
const RECLAIM_INTERVAL_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 给 Promise 加超时兜底。竞速失败的一方仍会被 Promise.race 内部消费，不会产生
 * unhandledRejection；但底层调用不会因此被取消（由 provider 自身的超时中止）。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`job 处理超时（>${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 分析 worker 池：固定并发地从 analysis_jobs 队列认领任务并执行。
 *
 * 借 PG 行锁（FOR UPDATE SKIP LOCKED）认领，可在同一 AppModule（与 HTTP 同进程）运行，
 * 也可在独立进程（worker-main.ts）运行——多消费者并发认领不冲突。
 *
 * 不卡死的几道保障：队列持久化（重启续跑、启动回收孤儿 running）、每 job 硬超时、
 * running 心跳 + 周期回收僵死（崩溃循环受 max_attempts 保护）。
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private stopping = false;
  private loops: Promise<void>[] = [];
  private reclaimTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly jobs: JobsRepository,
    private readonly posts: PostsRepository,
    private readonly comments: CommentsRepository,
    private readonly analysis: AnalysisService,
    private readonly analysisConfig: AnalysisConfigService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { concurrency, staleSeconds } = this.env.worker;
    // 启动即回收上次进程遗留的 running 任务（进程被杀时它们停在 running）
    const orphaned = await this.jobs.reclaimRunningJobs(nowSec(), null);
    if (orphaned > 0) logger.warn(`[worker] 启动回收 ${orphaned} 个遗留 running 任务`);

    this.reclaimTimer = setInterval(() => {
      void this.jobs.reclaimRunningJobs(nowSec(), staleSeconds).then((n) => {
        if (n > 0) logger.warn(`[worker] 回收 ${n} 个僵死任务（心跳超 ${staleSeconds}s）`);
      });
    }, RECLAIM_INTERVAL_MS);

    this.loops = Array.from({ length: concurrency }, () => this.loop());
    const stats = await this.jobs.getJobStats();
    logger.info(
      `[worker] 分析 worker 池已启动（并发 ${concurrency}）；当前队列 queued ${stats.queued} / running ${stats.running}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.reclaimTimer) clearInterval(this.reclaimTimer);
    await Promise.allSettled(this.loops);
  }

  private async runJob(job: JobRow): Promise<void> {
    const post = await this.posts.getPostById(job.post_id);
    if (!post) {
      await this.jobs.failJob(job.id, '帖子不存在或已归档', nowSec());
      return;
    }
    const processor =
      job.provider_id != null
        ? await this.analysisConfig.getProcessorForProvider(job.provider_id)
        : null;
    if (!processor) {
      // 配置问题（非帖子问题）：不递增 posts.analyze_attempts，修好配置后下轮可重试
      await this.jobs.failJob(
        job.id,
        `无法解析模型配置（provider_id=${job.provider_id ?? 'null'}），请检查设置`,
        nowSec(),
      );
      return;
    }
    const comments = await this.comments.getCommentsForPost(job.post_id);
    const heartbeat = setInterval(() => {
      void this.jobs.touchHeartbeat(job.id, nowSec());
    }, HEARTBEAT_INTERVAL_MS);
    try {
      const { saved } = await withTimeout(
        this.analysis.analyzeAndPersist(processor, post, comments),
        this.env.worker.jobTimeoutMs,
      );
      await this.posts.markAnalyzed(post.id, nowSec());
      await this.jobs.succeedJob(job.id, nowSec());
      if (saved) {
        logger.info(`  ✓ [job#${job.id}] r/${post.subreddit}「${post.title.slice(0, 40)}」已落库`);
      }
    } catch (err) {
      await this.posts.bumpAnalyzeAttempts(post.id);
      const msg = err instanceof Error ? err.message : String(err);
      await this.jobs.failJob(job.id, msg, nowSec());
      logger.error(`  ✗ [job#${job.id}] ${post.id} 失败: ${msg}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      const job = await this.jobs.claimNextJob(nowSec());
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      // runJob 内部已兜底异常；此处再加一层，确保单条意外永不拖垮 worker 循环
      try {
        await this.runJob(job);
      } catch (err) {
        logger.error(
          `[worker] runJob 未捕获异常: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
