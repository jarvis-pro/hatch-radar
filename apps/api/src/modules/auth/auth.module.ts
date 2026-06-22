import { Module } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';
import { AccountModule } from '@/modules/account/account.module';
import { AuthController } from './auth.controller';
import { DeviceOrSessionGuard } from './device-or-session.guard';

/**
 * 设备认证模块：激活端点（AuthController）+ 设备/会话双通道守卫。
 * DeviceAuthService 本体在 @/domain（CoreModule 提供，须显式 import——CoreModule 已去 @Global）；
 * 守卫的会话分支复用 AccountModule 导出的 SessionAuthenticator（与 SessionAuthGuard 同一实现）。
 * 导出 DeviceOrSessionGuard 供 HttpModule 的受保护控制器（sync/export）使用。
 */
@Module({
  imports: [CoreModule, AccountModule],
  controllers: [AuthController],
  providers: [DeviceOrSessionGuard],
  exports: [DeviceOrSessionGuard],
})
export class AuthModule {}
