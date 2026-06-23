import { Controller, Get } from '@nestjs/common';
import { Public } from '@/modules/account/auth-user.decorator';
import { nowSec } from '@/utils/time';
import { StatsRepository } from '@/database';

/**
 * GET /api/health —— 健康检查 + 数据概览（@Public 豁免全局会话守卫，供未登录探活）。
 * 响应结构保持与裸跑实现一致：`{ ok, now, stats }`。
 */
@Controller('health')
export class HealthController {
  constructor(private readonly stats: StatsRepository) {}

  @Public()
  @Get()
  async health(): Promise<{
    ok: true;
    now: number;
    stats: Awaited<ReturnType<StatsRepository['getStats']>>;
  }> {
    return { ok: true, now: nowSec(), stats: await this.stats.getStats() };
  }
}
