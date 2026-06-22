import { Module } from '@nestjs/common';
import { AccountModule } from '@/modules/account/account.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { ExportModule } from '@/modules/export/export.module';
import { PipelineModule } from '@/modules/pipeline/pipeline.module';
import { RadarModule } from '@/modules/radar/radar.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { SourcesModule } from '@/modules/sources/sources.module';
import { SyncModule } from '@/modules/sync/sync.module';
import { TranslationModule } from '@/modules/translation/translation.module';
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
 * 按需 import 各 feature module 取其导出的领域服务（替代原先的全局 CoreModule）——控制器能注入什么，
 * 由本模块 imports 显式声明：
 * - AccountModule  /api/me（AccountService）+ 会话守卫；
 * - AuthModule     双通道守卫 + sync 控制器的 DeviceAuthService；
 * - PipelineModule analysis（TaskControlService）/ pipeline 控制器；
 * - RadarModule / SettingsModule / SourcesModule / SyncModule / ExportModule / TranslationModule  各自领域控制器。
 * dashboard / health / requests 仅用全局仓储，无需额外 import。
 */
@Module({
  imports: [
    AccountModule,
    AuthModule,
    PipelineModule,
    RadarModule,
    SettingsModule,
    SourcesModule,
    SyncModule,
    ExportModule,
    TranslationModule,
  ],
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
