import { Module } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';
import { WorkerStarter } from './worker.starter';

/**
 * 内嵌执行器模块：单进程归一后，任务执行与 HTTP / 调度同进程。
 * WorkerService / LocalDispatcher 本体在 @/domain（CoreModule 提供，须显式 import——CoreModule
 * 已去 @Global）；本模块只放 Nest 生命周期薄封装 WorkerStarter（启动起认领泵、关停排空在途任务）。
 */
@Module({
  imports: [CoreModule],
  providers: [WorkerStarter],
})
export class WorkerModule {}
