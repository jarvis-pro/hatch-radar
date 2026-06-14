import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { DeviceAuthService } from './device-auth.service';
import { MachineOrDeviceGuard } from './machine-or-device.guard';

/**
 * 设备认证模块：激活端点（AuthController）+ 设备/服务双通道守卫。
 * 导出 DeviceAuthService 与 MachineOrDeviceGuard 供 HttpModule 的受保护控制器（sync/export）使用。
 */
@Module({
  controllers: [AuthController],
  providers: [DeviceAuthService, MachineOrDeviceGuard],
  exports: [DeviceAuthService, MachineOrDeviceGuard],
})
export class AuthModule {}
