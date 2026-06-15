import { Module } from '@nestjs/common';
import { WorkerStarter } from './worker.starter';

/**
 * Worker 模块：分析 job 执行器 + Gateway WS 客户端（生命周期薄封装 WorkerStarter）。
 * WorkerService / WorkerAgentService 本体在 @hatch-radar/core（CoreModule 全局提供 WorkerService）。
 * 既可装入主进程 AppModule（同进程消费），也可装入独立 worker 进程根模块。
 */
@Module({
  providers: [WorkerStarter],
})
export class WorkerModule {}
