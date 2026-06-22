import { Module } from '@nestjs/common';
import { AnalyzeExecutor } from './analyze.executor';
import { CollectionExecutor } from './collection.executor';
import { LocalDispatcher } from './local-dispatcher';
import { WorkerService } from './worker.service';
import { AnalysisModule } from '@/modules/analysis/analysis.module';
import { WorkerStarter } from './worker.starter';

/**
 * 内嵌执行器上下文（单进程归一：任务执行与 HTTP / 调度同进程）：逐环节执行器（WorkerService +
 * CollectionExecutor + AnalyzeExecutor）+ 进程内派发器（LocalDispatcher）+ Nest 生命周期薄封装
 * （WorkerStarter：起认领泵 / 僵死回收，关停排空在途）。依赖 AnalysisModule（分析 / 翻译落库）。
 * 导出 WorkerService / LocalDispatcher 供 PipelineModule 派发与检视控制复用。
 */
@Module({
  imports: [AnalysisModule],
  providers: [WorkerService, CollectionExecutor, AnalyzeExecutor, LocalDispatcher, WorkerStarter],
  exports: [WorkerService, LocalDispatcher],
})
export class WorkerModule {}
