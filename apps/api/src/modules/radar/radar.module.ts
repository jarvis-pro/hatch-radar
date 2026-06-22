import { Module } from '@nestjs/common';
import { BlueprintService, ProcessService, RadarService } from '@/domain';
import { PipelineModule } from '@/modules/pipeline/pipeline.module';

/**
 * 雷达指挥室上下文：图纸 CRUD（BlueprintService）、进程 CRUD / 启停 / 触发（ProcessService）、
 * 指挥室聚合与只读视图（RadarService）。依赖 PipelineModule（进程触发委托 PipelineService）。
 */
@Module({
  imports: [PipelineModule],
  providers: [RadarService, BlueprintService, ProcessService],
  exports: [RadarService, BlueprintService, ProcessService],
})
export class RadarModule {}
