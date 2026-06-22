import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { AuthModule } from '@/modules/auth/auth.module';

/**
 * 当前用户上下文：`/api/me`（取 / 改本人资料，双通道）。用 DeviceOrSessionGuard + AccountService，
 * 故 import AuthModule（它再导出 AccountModule，一并带来守卫的 SessionAuthenticator 与 AccountService）。
 * 独立成模块而非并入 AccountModule——避免 Account↔Auth 成环。
 */
@Module({
  imports: [AuthModule],
  controllers: [MeController],
})
export class MeModule {}
