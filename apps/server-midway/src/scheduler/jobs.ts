import { ApplicationContext, type IMidwayContainer } from '@midwayjs/core';
import { Job, type IJob } from '@midwayjs/cron';
import type { SchedulerService } from '@hatch-radar/core';
import { TOK } from '@/common/tokens';

/**
 * @midwayjs/cron 任务类（对应 NestJS 版 SchedulerService 上的 @Cron 方法）。
 *
 * onTick 内「惰性解析」core 的 SchedulerService（registerObject 登记在 TOK.scheduler 下）：
 * cron 框架在启动期实例化 @Job,此时领域实例可能尚未登记;onTick 按计划在启动之后才触发,届时已就绪。
 * cron 表达式 5 段制,与 NestJS 版逐字相同。
 */

async function scheduler(container: IMidwayContainer): Promise<SchedulerService> {
  return container.getAsync<SchedulerService>(TOK.scheduler);
}

@Job({ cronTime: '0,30 * * * *', start: true })
export class ScanJob implements IJob {
  @ApplicationContext()
  container!: IMidwayContainer;

  async onTick(): Promise<void> {
    await (await scheduler(this.container)).scan();
  }
}

@Job({ cronTime: '10,40 * * * *', start: true })
export class CommentsJob implements IJob {
  @ApplicationContext()
  container!: IMidwayContainer;

  async onTick(): Promise<void> {
    await (await scheduler(this.container)).comments();
  }
}

@Job({ cronTime: '20 * * * *', start: true })
export class AnalyzeJob implements IJob {
  @ApplicationContext()
  container!: IMidwayContainer;

  async onTick(): Promise<void> {
    await (await scheduler(this.container)).analyze();
  }
}

@Job({ cronTime: '30 3 * * *', start: true })
export class ArchiveJob implements IJob {
  @ApplicationContext()
  container!: IMidwayContainer;

  async onTick(): Promise<void> {
    await (await scheduler(this.container)).archive();
  }
}
