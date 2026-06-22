import { Module } from '@nestjs/common';
import { TranslationOrchestrator } from './translation-orchestrator.service';
import { TranslationsController } from './translations.controller';
import { ExportModule } from '@/modules/export/export.module';
import { PipelineModule } from '@/modules/pipeline/pipeline.module';
import { AccountModule } from '@/modules/account/account.module';

/**
 * 内容翻译编排上下文（按需翻译 / 入队），及其 HTTP 控制器（`/api/translations`）。
 * 依赖 PipelineModule（翻译任务入队）+ ExportModule（导出时回填译文）+ AccountModule（SessionAuthGuard）。
 */
@Module({
  imports: [ExportModule, PipelineModule, AccountModule],
  controllers: [TranslationsController],
  providers: [TranslationOrchestrator],
  exports: [TranslationOrchestrator],
})
export class TranslationModule {}
