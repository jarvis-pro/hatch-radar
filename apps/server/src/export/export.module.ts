import { Module } from '@nestjs/common';
import { ExportService } from './export.service';

/**
 * 导出模块：从 PG 收集批次（ExportService）；产出 .sqlite/.json 的写入器是纯函数
 * （sqlite-writer，直接 import 使用，不进 DI）。
 */
@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
