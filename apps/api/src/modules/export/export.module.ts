import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { AuthModule } from '@/modules/auth/auth.module';

/**
 * 导出批次上下文（`.sqlite` / `.json` 导出供移动端离线研判），及其 HTTP 控制器（`/api/export`）。
 * 控制器走双通道守卫，故 import AuthModule（DeviceOrSessionGuard）。
 */
@Module({
  imports: [AuthModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
