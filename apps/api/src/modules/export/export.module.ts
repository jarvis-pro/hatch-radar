import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { AccountModule } from '@/modules/account/account.module';

/**
 * 导出批次上下文（`.json` 批次供本地下载 / 离线消费），及其 HTTP 控制器（`/api/export`）。
 * 控制器走会话守卫，故 import AccountModule（SessionAuthGuard）。
 */
@Module({
  imports: [AccountModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
