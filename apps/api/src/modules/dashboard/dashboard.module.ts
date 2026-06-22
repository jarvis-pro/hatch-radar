import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { AccountModule } from '@/modules/account/account.module';

/**
 * 看板上下文：`GET /api/dashboard` 指挥室看板聚合（Stats / Cost 仓储，全局）。
 * 走 SessionAuthGuard，故 import AccountModule。
 */
@Module({
  imports: [AccountModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
