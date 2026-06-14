import { Module } from '@nestjs/common';
import { AnalysisModule } from '@/analysis/analysis.module';
import { AuthModule } from '@/auth/auth.module';
import { BearerAuthGuard } from '@/common/bearer-auth.guard';
import { RepositoriesModule } from '@/db/repositories.module';
import { ExportModule } from '@/export/export.module';
import { SyncModule } from '@/sync/sync.module';
import { AnalysisController } from './analysis.controller';
import { ExportController } from './export.controller';
import { HealthController } from './health.controller';
import { SettingsController } from './settings.controller';
import { SyncController } from './sync.controller';

/**
 * 局域网 HTTP 层：健康检查 / 设置 / 分析 / 导出 / 同步 / 设备激活 控制器。
 * 鉴权：设置 / 分析走 BearerAuthGuard（服务令牌，仅 web 代理调）；导出 / 同步走 AuthModule 的
 * 双通道守卫（mobile 设备签名 或 服务令牌）；设备激活公开（激活码自鉴权）；健康检查公开。
 */
@Module({
  imports: [RepositoriesModule, AnalysisModule, SyncModule, ExportModule, AuthModule],
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
