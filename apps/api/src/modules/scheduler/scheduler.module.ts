import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { PipelineModule } from '@/modules/pipeline/pipeline.module';
import { SchedulerCron } from './scheduler.cron';

/**
 * 调度上下文：@nestjs/schedule + SchedulerCron（@Cron 薄封装）+ SchedulerService（心跳触发到期进程 +
 * 收尾完成的运行）。依赖 PipelineModule（fireDueProcesses / finalizeRunningRuns 委托 PipelineService）。
 */
@Module({
  imports: [ScheduleModule.forRoot(), PipelineModule],
  providers: [SchedulerService, SchedulerCron],
})
export class SchedulerModule {}
