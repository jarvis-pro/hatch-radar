import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerCron } from './scheduler.cron';

/**
 * 调度模块：注册 @nestjs/schedule + SchedulerCron（@Cron 薄封装,委托 core.SchedulerService）。
 * 仅装入主进程 AppModule；独立 worker 进程不含本模块（不重复跑定时任务）。
 * 领域逻辑在 @hatch-radar/core（CoreModule 全局提供 SchedulerService）。
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [SchedulerCron],
})
export class SchedulerModule {}
