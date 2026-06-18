import { Module } from '@nestjs/common';
import { AccountModule } from '@/account/account.module';
import { AuthModule } from '@/auth/auth.module';
import { AnalysisController } from './analysis.controller';
import { PipelineController } from './pipeline.controller';
import { ExportController } from './export.controller';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { SettingsController } from './settings.controller';
import { SourceConnectorsController, SourcesController } from './sources.controller';
import { SyncController } from './sync.controller';
import { TranslationsController } from './translations.controller';

/**
 * HTTP 层：健康检查 / 设置 / 分析 / 导出 / 同步 / 设备激活 控制器。
 * 鉴权：设置 / 分析 / 来源走 SessionAuthGuard（import AccountModule）；导出 / 同步走双通道守卫
 * （import AuthModule）；设备激活公开；健康检查公开。各领域服务由 CoreModule 全局提供。
 */
@Module({
  imports: [AccountModule, AuthModule],
  controllers: [
    HealthController,
    MeController,
    SettingsController,
    SourcesController,
    SourceConnectorsController,
    AnalysisController,
    PipelineController,
    ExportController,
    SyncController,
    TranslationsController,
  ],
})
export class HttpModule {}
