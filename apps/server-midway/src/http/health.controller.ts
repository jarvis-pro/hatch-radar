import { Controller, Get, Inject } from '@midwayjs/core';
import { nowSec, type StatsRepository } from '@hatch-radar/core';
import type { DbStats } from '@hatch-radar/shared';
import { TOK } from '@/common/tokens';

/**
 * GET /api/health —— 健康检查 + 数据概览（不鉴权，供 App 在局域网内探测工作台）。
 * 响应结构与 NestJS / 裸跑实现一致：`{ ok, now, stats }`。
 */
@Controller('/health')
export class HealthController {
  @Inject(TOK.stats)
  stats!: StatsRepository;

  @Get('/')
  async health(): Promise<{ ok: true; now: number; stats: DbStats }> {
    return { ok: true, now: nowSec(), stats: await this.stats.getStats() };
  }
}
