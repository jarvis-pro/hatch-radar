import { Module } from '@nestjs/common';
import { DeviceAuthService } from './device-auth.service';
import { AccountModule } from '@/modules/account/account.module';
import { AuthController } from './auth.controller';
import { DeviceOrSessionGuard } from './device-or-session.guard';

/**
 * 设备认证上下文：设备凭据服务（DeviceAuthService）+ 激活端点 + 设备/会话双通道守卫。
 * 守卫的会话分支复用 AccountModule 的 SessionAuthenticator。导出 DeviceOrSessionGuard / DeviceAuthService，
 * 并**再导出 AccountModule**——`@UseGuards(DeviceOrSessionGuard)` 在消费方模块（export / sync）里实例化时
 * 需解析守卫的 SessionAuthenticator 依赖，故让它随守卫的模块一起可用（消费方只 import AuthModule 即自洽）。
 */
@Module({
  imports: [AccountModule],
  controllers: [AuthController],
  providers: [DeviceAuthService, DeviceOrSessionGuard],
  exports: [DeviceOrSessionGuard, DeviceAuthService, AccountModule],
})
export class AuthModule {}
