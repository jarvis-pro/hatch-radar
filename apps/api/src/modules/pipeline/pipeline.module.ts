import { Module } from '@nestjs/common';
import { PipelineQueryService } from './pipeline-query.service';
import { PipelineService } from './pipeline.service';
import { TaskControlService } from './task-control.service';
import { AnalysisController } from './analysis.controller';
import { PipelineController } from './pipeline.controller';
import { AnalysisModule } from '@/modules/analysis/analysis.module';
import { WorkerModule } from '@/modules/worker/worker.module';

/**
 * 流水线编排上下文：图纸触发 → 建 run → 派生 task（PipelineService）、逐环节检视控制
 * （TaskControlService）、进程 / 任务只读视图（PipelineQueryService），及其 HTTP 控制器
 * （`/api/pipeline` + `/api/analysis/inspect`——analysis 控制器用 TaskControlService，故归此处而非
 * AnalysisModule，避免 Pipeline↔Analysis 成环）。
 * 依赖 WorkerModule（LocalDispatcher 派发）+ AnalysisModule（active 模型解析）；鉴权走全局会话守卫。
 */
@Module({
  imports: [WorkerModule, AnalysisModule],
  controllers: [PipelineController, AnalysisController],
  providers: [PipelineService, TaskControlService, PipelineQueryService],
  exports: [PipelineService, TaskControlService, PipelineQueryService],
})
export class PipelineModule {}
