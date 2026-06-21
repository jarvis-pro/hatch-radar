import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchedulerService } from '@/domain';

/**
 * Nest 侧定时任务薄封装：把 @nestjs/schedule 的 @Cron 挂在方法上，委托 core 的 SchedulerService。
 *
 * 调度已图纸 / 进程化——固定 4 cron（scan/comments/analyze/archive）收敛为：一个「心跳」
 * （触发到期进程 + 收尾完成的运行）+ 一个每日归档。初始触发由种子进程的 next_run_at 驱动，无需 onApplicationBootstrap。
 */
@Injectable()
export class SchedulerCron {
  constructor(private readonly scheduler: SchedulerService) {}

  /** 调度心跳：每 15 秒触发到期进程并收尾完成的运行（6 段 cron，含秒）。 */
  @Cron('*/15 * * * * *')
  heartbeat(): Promise<void> {
    return this.scheduler.heartbeat();
  }

  /** 历史归档：每天凌晨 3:30。 */
  @Cron('30 3 * * *')
  archive(): Promise<void> {
    return this.scheduler.archive();
  }
}
