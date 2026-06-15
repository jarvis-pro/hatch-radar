import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AnalysisConfigService } from '@/analysis/analysis-config.service';
import { AnalysisService } from '@/analysis/analysis.service';
import { RuntimeSettingsService } from '@/config/runtime-settings.service';
import { nowSec } from '@/utils/time';
import { CommentsRepository } from '@/db/comments.repository';
import { JobsRepository } from '@/db/jobs.repository';
import { PostsRepository } from '@/db/posts.repository';
import { logger } from '@/logger';

/** running 期间的 DB 心跳间隔（毫秒），需远小于运行期设置 workerStaleSeconds（下界 30s） */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** 周期性僵死回收间隔（毫秒） */
const RECLAIM_INTERVAL_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`job 处理超时（>${ms}ms）`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 供 WorkerAgentService 分发时传入的最小 job 信息 */
export interface DispatchedJobInfo {
  id: number;
  post_id: string;
  provider_id: number | null;
}

/**
 * 分析 job 执行器：接受 Gateway 分发的任务，执行 AI 分析并将结果写回数据库。
 *
 * 不包含轮询逻辑——任务认领由 GatewayService 负责（Push 模式）。
 * 僵死回收定时器保留：仍处理进程崩溃后遗留的 running 任务。
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private reclaimTimer: ReturnType<typeof setInterval> | null = null;
  private activeJobPromises: Promise<void>[] = [];

  constructor(
    private readonly jobs: JobsRepository,
    private readonly posts: PostsRepository,
    private readonly comments: CommentsRepository,
    private readonly analysis: AnalysisService,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const orphaned = await this.jobs.reclaimRunningJobs(nowSec(), null);
    if (orphaned > 0) logger.warn(`[worker] 启动回收 ${orphaned} 个遗留 running 任务`);

    // 每轮实时读取回收阈值——设置页改 workerStaleSeconds 后下一轮即生效（含独立 worker 进程）
    this.reclaimTimer = setInterval(() => {
      void (async () => {
        const { staleSeconds } = await this.runtimeSettings.getWorkerTuning();
        const n = await this.jobs.reclaimRunningJobs(nowSec(), staleSeconds);
        if (n > 0) logger.warn(`[worker] 回收 ${n} 个僵死任务（心跳超 ${staleSeconds}s）`);
      })();
    }, RECLAIM_INTERVAL_MS);

    const stats = await this.jobs.getJobStats();
    logger.info(
      `[worker] 分析执行器已就绪；当前队列 queued ${stats.queued} / running ${stats.running}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.reclaimTimer) clearInterval(this.reclaimTimer);
    await Promise.allSettled(this.activeJobPromises);
  }

  /** 当前正在执行的任务数（供 WorkerAgentService 上报心跳） */
  get activeJobCount(): number {
    return this.activeJobPromises.length;
  }

  /**
   * 执行由 Gateway 分发来的任务（job 已被 Gateway 认领为 running）。
   * @param job 任务标识（id / post_id / provider_id）
   * @param onProgress job 执行期间的心跳回调，用于通知 Gateway 任务仍在进行
   */
  async executeDispatchedJob(
    job: DispatchedJobInfo,
    onProgress?: (jobId: number) => void,
  ): Promise<void> {
    const p = this.runJob(job, onProgress);
    this.activeJobPromises.push(p);
    try {
      await p;
    } finally {
      this.activeJobPromises = this.activeJobPromises.filter((x) => x !== p);
    }
  }

  private async runJob(
    job: DispatchedJobInfo,
    onProgress?: (jobId: number) => void,
  ): Promise<void> {
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
      await this.jobs.failJob(
        job.id,
        `无法解析模型配置（provider_id=${job.provider_id ?? 'null'}），请检查设置`,
        nowSec(),
      );
      return;
    }
    const commentsData = await this.comments.getCommentsForPost(job.post_id);
    const heartbeat = setInterval(() => {
      void this.jobs.touchHeartbeat(job.id, nowSec());
      onProgress?.(job.id);
    }, HEARTBEAT_INTERVAL_MS);
    const ac = new AbortController();
    const { jobTimeoutMs } = await this.runtimeSettings.getWorkerTuning();
    try {
      const { saved } = await withTimeout(
        this.analysis.analyzeAndPersist(processor, post, commentsData, ac.signal),
        jobTimeoutMs,
        () => ac.abort(new Error('job 超时，中止底层调用')),
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
}
