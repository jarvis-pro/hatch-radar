import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CoreModule } from '@/core/core.module';
import { SchedulerCron } from './scheduler.cron';

/**
 * 调度模块：注册 @nestjs/schedule + SchedulerCron（@Cron 薄封装,委托 core.SchedulerService）。
 * 领域逻辑在 @/domain（CoreModule 提供 SchedulerService，须显式 import——CoreModule 已去 @Global）。
 */
@Module({
  imports: [ScheduleModule.forRoot(), CoreModule],
  providers: [SchedulerCron],
})
export class SchedulerModule {}
