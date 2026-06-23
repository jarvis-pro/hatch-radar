import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';

/**
 * 看板上下文：`GET /api/dashboard` 指挥室看板聚合（Stats / Cost 仓储，全局）。
 * 鉴权走全局会话守卫。
 */
@Module({
  controllers: [DashboardController],
})
export class DashboardModule {}
