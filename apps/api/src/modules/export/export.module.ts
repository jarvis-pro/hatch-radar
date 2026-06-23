import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';

/**
 * 导出批次上下文（`.json` 批次供本地下载 / 离线消费），及其 HTTP 控制器（`/api/export`）。
 * 鉴权走全局会话守卫。
 */
@Module({
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
