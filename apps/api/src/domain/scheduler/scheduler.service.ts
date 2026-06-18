import { JobsRepository } from '@hatch-radar/db';
import { PostsRepository } from '@hatch-radar/db';
import { logger } from '@hatch-radar/kernel';
import { nowSec } from '@hatch-radar/kernel';
import { PipelineService } from '@/domain/pipeline/pipeline.service';

const ARCHIVE_DAYS = 30;

/**
 * 定时调度服务：触发采集 / 复查 / 分析图纸 + 历史归档。
 *
 * 抓取已全部下沉到 worker（经请求闸限速 / 可视化 / 可暂停）：本服务只「触发图纸」——建进程派生任务，
 * 由 worker 认领执行（不再在 api 直接爬取，双爬虫已消除）。
 * - cron 由 app 侧 SchedulerCron（@nestjs/schedule）触发；同名不并发由 {@link guard} 保证。
 * - 初始化轮次由 onApplicationBootstrap 调 {@link runInitialRound}。
 * - guard 为进程内内存态、无分布式锁 → 本服务（api 控制面）须单实例部署。
 */
export class SchedulerService {
  /** 正在执行的触发名集合（同名不并发） */
  private readonly running = new Set<string>();

  constructor(
    private readonly postsRepo: PostsRepository,
    private readonly jobsRepo: JobsRepository,
    private readonly pipeline: PipelineService,
  ) {}

  /** 启动后的一次性初始化轮次：采集 → 复查 → 分析。 */
  async runInitialRound(): Promise<void> {
    logger.info('启动初始化轮次：采集 → 复查 → 分析');
    await this.collect();
    await this.recheck();
    await this.analyze();
    logger.info('初始化轮次完成，进入定时调度（进程 / 洞察可在 web 控制台查看）');
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

  /** 采集：触发采集图纸（discover 抓列表去重派生 collect），worker 经请求闸执行。cron: '0,30 * * * *'。 */
  collect(): Promise<void> {
    return this.guard('采集', async () => {
      const { runId } = await this.pipeline.runCollectSweep('cron');
      logger.info(`[采集] 已触发采集进程#${runId}，交由 worker 抓取`);
    });
  }

  /** 复查：触发复查 sweep（选到期旧帖派生 recheck），worker 经请求闸执行。cron: '10,40 * * * *'。 */
  recheck(): Promise<void> {
    return this.guard('复查', async () => {
      const { runId, sweep, due } = await this.pipeline.runRecheckSweep('cron');
      logger.info(`[复查] 已触发 sweep#${sweep} 进程#${runId}（${due} 帖到期），交由 worker 复查`);
    });
  }

  /**
   * AI 分析：触发分析 sweep（补扫待分析帖；多数分析已由采集 / 复查事件派生）。
   * 仅当已选用 active 模型时派生。cron: '20 * * * *'。
   */
  analyze(): Promise<void> {
    return this.guard('AI 分析派生', async () => {
      const { active, created, pending } = await this.pipeline.runAnalyzeSweep('cron');
      if (!active) {
        logger.info('[AI 分析] 未配置 active 模型，跳过自动派生（可在设置页配置）');
        return;
      }
      logger.info(
        `[AI 分析] 派生 ${created} 个分析任务（${pending} 待分析，模型 ${active.label}），交由 worker 处理`,
      );
    });
  }

  /** 历史归档：每天凌晨 3:30，清理 30 天前的原始帖子与评论数据。cron: '30 3 * * *'。 */
  archive(): Promise<void> {
    return this.guard('归档', async () => {
      const cutoff = nowSec() - ARCHIVE_DAYS * 86400;
      const removed = await this.postsRepo.archiveOldData(cutoff);
      const removedJobs = await this.jobsRepo.deleteFinishedJobsBefore(cutoff);
      logger.info(
        `[归档] 清理 ${ARCHIVE_DAYS} 天前原始数据：帖子 ${removed.posts}，评论 ${removed.comments}，终态分析任务 ${removedJobs}（洞察保留）`,
      );
    });
  }
}
