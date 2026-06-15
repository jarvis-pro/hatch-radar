import { Module } from '@nestjs/common';
import { AccountModule } from '@/account/account.module';
import { AuthController } from './auth.controller';
import { DeviceAuthService } from './device-auth.service';
import { DeviceOrSessionGuard } from './device-or-session.guard';

/**
 * 设备认证模块：激活端点（AuthController）+ 设备/会话双通道守卫。
 * 导出 DeviceAuthService 与 DeviceOrSessionGuard 供 HttpModule 的受保护控制器（sync/export）使用。
 * 导入 AccountModule：双通道守卫的会话分支复用 AccountService。
 */
@Module({
  imports: [AccountModule],
  controllers: [AuthController],
  providers: [DeviceAuthService, DeviceOrSessionGuard],
  exports: [DeviceAuthService, DeviceOrSessionGuard],
})
export class AuthModule {}
