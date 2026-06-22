import { Module } from '@nestjs/common';
import { DeviceAuthService } from './device-auth.service';
import { AccountModule } from '@/modules/account/account.module';
import { AuthController } from './auth.controller';
import { DeviceOrSessionGuard } from './device-or-session.guard';

/**
 * 设备认证上下文：设备凭据服务（DeviceAuthService）+ 激活端点 + 设备/会话双通道守卫。
 * 守卫的会话分支复用 AccountModule 导出的 SessionAuthenticator。导出 DeviceOrSessionGuard（受保护
 * 控制器如 sync/export 用）与 DeviceAuthService（HttpModule 的 sync 控制器直接用）。
 */
@Module({
  imports: [AccountModule],
  controllers: [AuthController],
  providers: [DeviceAuthService, DeviceOrSessionGuard],
  exports: [DeviceOrSessionGuard, DeviceAuthService],
})
export class AuthModule {}
