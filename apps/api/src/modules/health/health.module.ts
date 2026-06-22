import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** 健康检查上下文：`GET /api/health`（公开、无守卫；只读全局 StatsRepository）。 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
