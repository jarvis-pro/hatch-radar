import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { DeviceOrSessionGuard } from './device-or-session.guard';

/**
 * 设备认证模块：激活端点（AuthController）+ 设备/会话双通道守卫。
 * DeviceAuthService 本体在 @hatch-radar/core（CoreModule 全局提供）；守卫的会话分支亦复用全局 AccountService。
 * 导出 DeviceOrSessionGuard 供 HttpModule 的受保护控制器（sync/export）使用。
 */
@Module({
  controllers: [AuthController],
  providers: [DeviceOrSessionGuard],
  exports: [DeviceOrSessionGuard],
})
export class AuthModule {}
