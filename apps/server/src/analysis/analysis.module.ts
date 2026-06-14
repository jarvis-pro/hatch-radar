import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/db/repositories.module';
import { AnalysisConfigService } from './analysis-config.service';
import { AnalysisService } from './analysis.service';

/**
 * 分析模块：模型配置/选用/入队（AnalysisConfigService）+ 「分析并落库」编排（AnalysisService）。
 */
@Module({
  imports: [RepositoriesModule],
  providers: [AnalysisConfigService, AnalysisService],
  exports: [AnalysisConfigService, AnalysisService],
})
export class AnalysisModule {}
