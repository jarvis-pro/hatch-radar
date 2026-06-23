import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { SourceConnectorsController, SourcesController } from './sources.controller';

/**
 * 数据来源 / 采集连接器编排上下文，及其 HTTP 控制器（`/api/sources` · `/api/source-connectors`）。
 * 依赖全局仓储 + CrawlerConfigService（CapabilityModule）；鉴权走全局会话守卫。
 */
@Module({
  controllers: [SourcesController, SourceConnectorsController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
