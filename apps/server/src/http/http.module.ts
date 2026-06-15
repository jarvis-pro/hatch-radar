import { Module } from '@nestjs/common';
import { AccountModule } from '@/account/account.module';
import { AnalysisModule } from '@/analysis/analysis.module';
import { AuthModule } from '@/auth/auth.module';
import { RuntimeSettingsModule } from '@/config/runtime-settings.module';
import { CrawlerModule } from '@/crawler/crawler.module';
import { RepositoriesModule } from '@/db/repositories.module';
import { ExportModule } from '@/export/export.module';
import { SyncModule } from '@/sync/sync.module';
import { AnalysisController } from './analysis.controller';
import { ExportController } from './export.controller';
import { HealthController } from './health.controller';
import { SettingsController } from './settings.controller';
import { SourceConnectorsController, SourcesController } from './sources.controller';
import { SyncController } from './sync.controller';

/**
 * HTTP 层：健康检查 / 设置 / 分析 / 导出 / 同步 / 设备激活 控制器。
 * 鉴权（后端归一后单一权威）：设置 / 分析 / 来源走 SessionAuthGuard + 能力闸（web 用户会话）；
 * 导出 / 同步走双通道守卫（mobile 设备签名 或 用户会话）；设备激活公开（激活码自鉴权）；健康检查公开。
 */
@Module({
  imports: [
    RepositoriesModule,
    RuntimeSettingsModule,
    AccountModule,
    AnalysisModule,
    SyncModule,
    ExportModule,
    AuthModule,
    CrawlerModule,
  ],
  controllers: [
    HealthController,
    SettingsController,
    SourcesController,
    SourceConnectorsController,
    AnalysisController,
    ExportController,
    SyncController,
  ],
})
export class HttpModule {}
