import { Controller, Get } from '@nestjs/common';
import { StatsRepository } from '../db/stats.repository';
import { nowSec } from '../common/time';

/**
 * GET /api/health —— 健康检查 + 数据概览（不鉴权，供 App 在局域网内探测工作台）。
 * 响应结构保持与裸跑实现一致：`{ ok, now, stats }`。
 */
@Controller('health')
export class HealthController {
  constructor(private readonly stats: StatsRepository) {}

  @Get()
  async health(): Promise<{
    ok: true;
    now: number;
    stats: Awaited<ReturnType<StatsRepository['getStats']>>;
  }> {
    return { ok: true, now: nowSec(), stats: await this.stats.getStats() };
  }
}
