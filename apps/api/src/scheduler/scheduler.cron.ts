import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchedulerService } from '@/domain';

/**
 * Nest 侧定时任务薄封装：把 @nestjs/schedule 的 @Cron 挂在方法上,委托 core 的 SchedulerService
 * （非重入 guard、采集/复查/分析/归档触发、初始化轮次都在 core）。抓取已下沉 worker（经请求闸）。
 */
@Injectable()
export class SchedulerCron implements OnApplicationBootstrap {
  constructor(private readonly scheduler: SchedulerService) {}

  /** 启动后跑一轮初始化（扫描 → 评论补全 → 分析入队），不阻塞 HTTP 监听。 */
  onApplicationBootstrap(): void {
    void this.scheduler.runInitialRound();
  }

  @Cron('0,30 * * * *')
  collect(): Promise<void> {
    return this.scheduler.collect();
  }

  @Cron('10,40 * * * *')
  recheck(): Promise<void> {
    return this.scheduler.recheck();
  }

  @Cron('20 * * * *')
  analyze(): Promise<void> {
    return this.scheduler.analyze();
  }

  @Cron('30 3 * * *')
  archive(): Promise<void> {
    return this.scheduler.archive();
  }
}
