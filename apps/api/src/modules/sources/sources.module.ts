import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service';

/**
 * 数据来源 / 采集连接器编排上下文。叶子模块：依赖全局仓储 + CrawlerConfigService（CapabilityModule）。
 */
@Module({
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
