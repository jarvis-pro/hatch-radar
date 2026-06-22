import { Module } from '@nestjs/common';
import { AccountModule } from '@/modules/account/account.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { DashboardController } from './dashboard.controller';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { RequestsController } from './requests.controller';

/**
 * HTTP 边缘模块：无专属 feature module 归属的跨切 / 双通道控制器——
 * - `dashboard` 看板聚合（Stats / Cost 仓储，全局）
 * - `health` 健康检查（公开）
 * - `requests` 出站请求闸视图（RequestQueue / Lanes 仓储，全局）
 * - `me` 双通道当前用户（AccountService + DeviceOrSessionGuard；放 AccountModule 会与 AuthModule 成环，故留此）
 *
 * 其余业务控制器已各归其 feature module。imports：AccountModule（SessionAuthGuard + AccountService）、
 * AuthModule（me 的 DeviceOrSessionGuard）。
 */
@Module({
  imports: [AccountModule, AuthModule],
  controllers: [DashboardController, HealthController, MeController, RequestsController],
})
export class HttpModule {}
