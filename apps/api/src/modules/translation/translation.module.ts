import { Module } from '@nestjs/common';
import { TranslationOrchestrator } from '@/domain';
import { ExportModule } from '@/modules/export/export.module';
import { PipelineModule } from '@/modules/pipeline/pipeline.module';

/**
 * 内容翻译编排上下文（按需翻译 / 入队）。
 * 依赖 PipelineModule（翻译任务入队）+ ExportModule（导出时回填译文）。
 */
@Module({
  imports: [ExportModule, PipelineModule],
  providers: [TranslationOrchestrator],
  exports: [TranslationOrchestrator],
})
export class TranslationModule {}
