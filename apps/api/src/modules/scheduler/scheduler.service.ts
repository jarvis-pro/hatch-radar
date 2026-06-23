import { Injectable } from '@nestjs/common';
import { PostsRepository } from '@/database';
import { TasksRepository } from '@/database';
import { logger } from '@/logger';
import { nowSec } from '@/utils/time';
import { PipelineService } from '@/modules/pipeline/pipeline.service';

/** 原始数据归档阈值（天）：超过即清理帖子 / 评论 / 终态任务（洞察永久保留）。 */
const ARCHIVE_DAYS = 30;

/**
 * 调度服务：以「心跳」取代旧 4 个固定 @Cron。
 *
 * 每跳触发到期进程（active 且 next_run_at≤now、且无进行中运行）并收尾已全部终结的运行、为其进程重排下一轮。
 * 调度策略（once / interval / cron + 复查退避）全落在 processes 表 + {@link PipelineService}，本服务只管节奏与非重入。
 * - cron 由 app 侧 SchedulerCron（@nestjs/schedule）触发；心跳同名不并发由内存集合保证。
 * - 初始触发由种子进程的 next_run_at=now 驱动（首个心跳即触发），不再有 runInitialRound。
 * - 单实例语义不变（内存非重入、无分布式锁）→ api 控制面须单实例部署。
 */
@Injectable()
export class SchedulerService {
  /** 正在执行的触发名集合（同名不并发） */
  private readonly running = new Set<string>();

  constructor(
    private readonly postsRepo: PostsRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly pipeline: PipelineService,
  ) {}

  /** 调度心跳：触发到期进程 + 收尾完成的运行并重排。非重入、异常只记录（高频，不打成功日志）。 */
  heartbeat(): Promise<void> {
    if (this.running.has('heartbeat')) {
      return Promise.resolve();
    }

    this.running.add('heartbeat');

    return (async () => {
      try {
        await this.pipeline.fireDueProcesses();
        await this.pipeline.finalizeRunningRuns();
      } catch (err) {
        logger.error(`[心跳] 出错: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.running.delete('heartbeat');
      }
    })();
  }

  /** 包装触发：同名不并发（上一轮未结束则跳过），异常只记录不抛出。 */
  private async guard(name: string, fn: () => Promise<void>): Promise<void> {
    if (this.running.has(name)) {
      logger.warn(`[${name}] 上一轮仍在执行，跳过本轮`);

      return;
    }

    this.running.add(name);
    const started = Date.now();
    try {
      await fn();
      logger.info(`[${name}] 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      logger.error(`[${name}] 出错: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running.delete(name);
    }
  }

  /** 历史归档：每天凌晨 3:30，清理 30 天前的原始帖子 / 评论 / 终态任务（洞察保留）。cron: '30 3 * * *'。 */
  archive(): Promise<void> {
    return this.guard('归档', async () => {
      const cutoff = nowSec() - ARCHIVE_DAYS * 86400;
      const removed = await this.postsRepo.archiveOldData(cutoff);
      const removedTasks = await this.tasksRepo.deleteFinishedTasksBefore(cutoff);
      logger.info(
        `[归档] 清理 ${ARCHIVE_DAYS} 天前原始数据：帖子 ${removed.posts}，评论 ${removed.comments}，终态任务 ${removedTasks}（洞察保留）`,
      );
    });
  }
}
