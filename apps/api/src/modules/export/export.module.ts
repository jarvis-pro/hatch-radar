import { Module } from '@nestjs/common';
import { ExportService } from './export.service';

/**
 * 导出批次上下文（.sqlite / .json 导出供移动端离线研判）。叶子模块：仅依赖全局持久层。
 */
@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
