import { Controller, Get, UseGuards } from '@nestjs/common';
import type { DashboardData } from '@hatch-radar/shared';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { CostRepository, GatewayService, nowSec, StatsRepository, TasksRepository } from '@/domain';

/** 成本统计窗口（天） */
const COST_WINDOW_DAYS = 30;
/** 吞吐趋势窗口（天） */
const THROUGHPUT_DAYS = 14;

/**
 * GET /api/dashboard —— 看板聚合数据（概览 / 队列 / Worker 状态 / 成本 / 吞吐 / 洞察分布）。
 * 一次往返取齐，前端按需轮询；需 insights:view（最基础的数据查看能力）。
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('insights:view')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly stats: StatsRepository,
    private readonly cost: CostRepository,
    private readonly tasks: TasksRepository,
    private readonly gateway: GatewayService,
  ) {}

  @Get()
  async get(): Promise<DashboardData> {
    const now = nowSec();
    const [overview, queue, costStats, dailyCost, throughput, insights] = await Promise.all([
      this.stats.getStats(),
      this.tasks.taskStats(),
      this.cost.getCostStats(now - COST_WINDOW_DAYS * 86_400),
      this.cost.getDailyCost(COST_WINDOW_DAYS),
      this.cost.getThroughput(THROUGHPUT_DAYS),
      this.stats.getInsightBreakdown(),
    ]);
    const workers = this.gateway.getWorkerStatuses().map((w) => ({
      workerId: w.workerId,
      concurrency: w.concurrency,
      activeJobs: w.activeJobs,
      cpu: w.cpu,
      memory: w.memory,
      lastHeartbeatAgo: Math.max(0, Math.floor((Date.now() - w.lastHeartbeat) / 1000)),
    }));
    return {
      overview,
      queue,
      workers,
      cost: {
        windowDays: COST_WINDOW_DAYS,
        totalCost: costStats.totals.cost,
        inputTokens: costStats.totals.inputTokens,
        outputTokens: costStats.totals.outputTokens,
        cacheWriteTokens: costStats.totals.cacheWriteTokens,
        cacheReadTokens: costStats.totals.cacheReadTokens,
        byModel: costStats.byModel,
        daily: dailyCost,
      },
      throughput,
      insights,
    };
  }
}
