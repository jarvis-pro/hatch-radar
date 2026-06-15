import { Controller, Get, UseGuards } from '@nestjs/common';
import type { DbStats } from '@hatch-radar/shared';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { StatsRepository } from '@hatch-radar/core';

/**
 * GET /api/stats —— 概览计数（首页统计卡片）。任意登录用户可见，无特定能力闸。
 * 口径复用 StatsRepository（与启动日志 / 健康检查单一数据源）。
 */
@UseGuards(SessionAuthGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsRepository) {}

  @Get()
  get(): Promise<DbStats> {
    return this.stats.getStats();
  }
}
