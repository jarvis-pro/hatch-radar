import { Module } from '@nestjs/common';
import { BlueprintService } from './blueprint.service';
import { ProcessService } from './process.service';
import { RadarService } from './radar.service';
import { BlueprintsController, ProcessesController, RadarController } from './radar.controller';
import { PipelineModule } from '@/modules/pipeline/pipeline.module';
import { AccountModule } from '@/modules/account/account.module';

/**
 * 雷达指挥室上下文：图纸 CRUD（BlueprintService）、进程 CRUD / 启停 / 触发（ProcessService）、
 * 指挥室聚合与只读视图（RadarService），及其 HTTP 控制器（`/api/radar` · `/api/blueprints` · `/api/processes`）。
 * 依赖 PipelineModule（进程触发委托 PipelineService）+ AccountModule（SessionAuthGuard）。
 */
@Module({
  imports: [PipelineModule, AccountModule],
  controllers: [RadarController, BlueprintsController, ProcessesController],
  providers: [RadarService, BlueprintService, ProcessService],
  exports: [RadarService, BlueprintService, ProcessService],
})
export class RadarModule {}
