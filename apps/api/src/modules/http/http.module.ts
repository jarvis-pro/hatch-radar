import { Module } from '@nestjs/common';
import { AccountModule } from '@/modules/account/account.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { AnalysisController } from './analysis.controller';
import { DashboardController } from './dashboard.controller';
import { PipelineController } from './pipeline.controller';
import { BlueprintsController, ProcessesController, RadarController } from './radar.controller';
import { RequestsController } from './requests.controller';
import { ExportController } from './export.controller';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { SettingsController } from './settings.controller';
import { SourceConnectorsController, SourcesController } from './sources.controller';
import { SyncController } from './sync.controller';
import { TranslationsController } from './translations.controller';

/**
 * HTTP 层：会话守卫下的业务控制器统一收口（看板 / 设置 / 分析 / 导出 / 同步 / 设备激活 等）。
 * 鉴权：看板 / 设置 / 分析 / 来源走 SessionAuthGuard（import AccountModule）；导出 / 同步走双通道守卫
 * （import AuthModule）；设备激活公开；健康检查公开。各领域服务由 CoreModule 全局提供。
 */
@Module({
  imports: [AccountModule, AuthModule],
  controllers: [
    HealthController,
    DashboardController,
    MeController,
    SettingsController,
    SourcesController,
    SourceConnectorsController,
    AnalysisController,
    PipelineController,
    BlueprintsController,
    ProcessesController,
    RadarController,
    RequestsController,
    ExportController,
    SyncController,
    TranslationsController,
  ],
})
export class HttpModule {}
