import { Module } from '@nestjs/common';
import { AnalysisConfigService } from './analysis-config.service';
import { AnalysisService } from './analysis.service';
import { TranslationService } from './translation.service';

/**
 * 分析能力上下文（AI 分析配置 / 引擎落库 + 译文落库）。
 * 叶子模块：仅依赖全局仓储 / 能力（RepositoryModule / CapabilityModule）与 @/analysis 引擎，不 import 其它领域模块。
 */
@Module({
  providers: [AnalysisConfigService, AnalysisService, TranslationService],
  exports: [AnalysisConfigService, AnalysisService, TranslationService],
})
export class AnalysisModule {}
