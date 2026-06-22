import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { AuthModule } from '@/modules/auth/auth.module';

/**
 * 移动端离线研判回传上下文（`/api/sync/push` 按 opId 幂等），及其 HTTP 控制器。
 * 控制器走双通道守卫且用 DeviceAuthService，故 import AuthModule（导出 DeviceOrSessionGuard + DeviceAuthService）。
 */
@Module({
  imports: [AuthModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
