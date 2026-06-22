import { Module } from '@nestjs/common';
import { SettingsService } from '@/domain';
import { AnalysisModule } from '@/modules/analysis/analysis.module';
import { PipelineModule } from '@/modules/pipeline/pipeline.module';

/**
 * 模型 / Key 池 / active 设置编排上下文。
 * 依赖 AnalysisModule（写后热重载 analysis 配置）+ PipelineModule（选用模型后触发一轮入队）。
 * 运行期可调项读取走全局 RuntimeSettingsService（CapabilityModule）。
 */
@Module({
  imports: [AnalysisModule, PipelineModule],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
