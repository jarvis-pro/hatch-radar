import { Module } from '@nestjs/common';
import { PipelineService, PipelineQueryService, TaskControlService } from '@/domain';
import { AnalysisModule } from '@/modules/analysis/analysis.module';
import { WorkerModule } from '@/modules/worker/worker.module';

/**
 * 流水线编排上下文：图纸触发 → 建 run → 派生 task（PipelineService）、逐环节检视控制
 * （TaskControlService）、进程 / 任务只读视图（PipelineQueryService）。
 * 依赖 WorkerModule（LocalDispatcher 派发）+ AnalysisModule（active 模型解析）——DAG，无环。
 */
@Module({
  imports: [WorkerModule, AnalysisModule],
  providers: [PipelineService, TaskControlService, PipelineQueryService],
  exports: [PipelineService, TaskControlService, PipelineQueryService],
})
export class PipelineModule {}
