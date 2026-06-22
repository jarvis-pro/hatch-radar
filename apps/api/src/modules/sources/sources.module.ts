import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { SourceConnectorsController, SourcesController } from './sources.controller';
import { AccountModule } from '@/modules/account/account.module';

/**
 * 数据来源 / 采集连接器编排上下文，及其 HTTP 控制器（`/api/sources` · `/api/source-connectors`）。
 * 依赖全局仓储 + CrawlerConfigService（CapabilityModule）+ AccountModule（SessionAuthGuard）。
 */
@Module({
  imports: [AccountModule],
  controllers: [SourcesController, SourceConnectorsController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
