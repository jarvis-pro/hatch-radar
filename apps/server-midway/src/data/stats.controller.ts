import { Controller, Get, Inject, UseGuard } from '@midwayjs/core';
import { type StatsRepository } from '@hatch-radar/core';
import type { DbStats } from '@hatch-radar/shared';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { TOK } from '@/common/tokens';

/**
 * GET /api/stats —— 概览计数（首页统计卡片）。任意登录用户可见，无特定能力闸。
 * 与 NestJS 版一致：口径复用 StatsRepository。
 */
@UseGuard(SessionAuthGuard)
@Controller('/stats')
export class StatsController {
  @Inject(TOK.stats)
  stats!: StatsRepository;

  @Get('/')
  get(): Promise<DbStats> {
    return this.stats.getStats();
  }
}
