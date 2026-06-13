import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { BearerAuthGuard } from '../common/bearer-auth.guard';
import { RepositoriesModule } from '../db/repositories.module';
import { ExportModule } from '../export/export.module';
import { SyncModule } from '../sync/sync.module';
import { AnalysisController } from './analysis.controller';
import { ExportController } from './export.controller';
import { HealthController } from './health.controller';
import { SettingsController } from './settings.controller';
import { SyncController } from './sync.controller';

/**
 * 局域网 HTTP 层：健康检查 / 设置 / 分析 / 导出 / 同步 控制器。
 * 鉴权由各控制器上的 BearerAuthGuard 完成（健康检查公开）。
 */
@Module({
  imports: [RepositoriesModule, AnalysisModule, SyncModule, ExportModule],
  controllers: [
    HealthController,
    SettingsController,
    AnalysisController,
    ExportController,
    SyncController,
  ],
  providers: [BearerAuthGuard],
})
export class HttpModule {}
