import { Module } from '@nestjs/common';
import { WorkerStarter } from './worker.starter';

/**
 * 内嵌执行器模块：单进程归一后，任务执行与 HTTP / 调度同进程。
 * WorkerService / LocalDispatcher 本体在 @/domain（CoreModule 全局提供）；本模块只放
 * Nest 生命周期薄封装 WorkerStarter（启动起认领泵、关停排空在途任务）。取代旧 GatewayModule。
 */
@Module({
  providers: [WorkerStarter],
})
export class WorkerModule {}
