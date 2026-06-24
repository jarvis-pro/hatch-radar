import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { BoardData, BoardRange } from '@hatch-radar/shared';
import { RequirePermission } from '@/common/auth-user.decorator';
import { CostRepository, StatsRepository } from '@/database';
import { nowSec } from '@/utils/time';

const DAY = 86_400;
const RANGES: readonly BoardRange[] = ['all', 'today', '7d', '30d'];

/** range → 起始 epoch 秒（all = null：不限时间）。 */
function rangeSince(range: BoardRange, now: number): number | null {
  switch (range) {
    case 'today':
      return now - (now % DAY);
    case '7d':
      return now - 7 * DAY;
    case '30d':
      return now - 30 * DAY;
    case 'all':
    default:
      return null;
  }
}

/** range → 趋势密集序列天数（today 仍画 1 根，all 回看 30 天）。 */
function rangeTrendDays(range: BoardRange): number {
  switch (range) {
    case 'today':
      return 1;
    case '7d':
      return 7;
    case '30d':
    case 'all':
    default:
      return 30;
  }
}

/**
 * GET /api/dashboard?range= —— 价值看板：价值漏斗（采集 → 分析 → 洞察，验证预留）+ 每日趋势
 * + 洞察质量（强度 / 标签）+ 来源洞察力 + ROI（每洞察成本）。运营指标（队列 / Worker / 吞吐 /
 * 成本明细）已切分至指挥室（GET /api/radar/control-room）。需 insights:view。
 */
@ApiTags('dashboard')
@RequirePermission('insights:view')
@Controller('dashboard')
export class DashboardController {
  constructor(
    // 统计仓储：价值漏斗 / 每日趋势 / 洞察质量 / 来源洞察力看板数据
    private readonly stats: StatsRepository,
    // 成本仓储：窗口成本统计（用于 ROI 每洞察成本）
    private readonly cost: CostRepository,
  ) {}

  @Get()
  async get(@Query('range') rangeParam?: string): Promise<BoardData> {
    const range: BoardRange = RANGES.includes(rangeParam as BoardRange)
      ? (rangeParam as BoardRange)
      : 'all';
    const now = nowSec();
    const since = rangeSince(range, now);
    const [board, costStats] = await Promise.all([
      this.stats.getBoard(since, rangeTrendDays(range)),
      this.cost.getCostStats(since ?? 0),
    ]);
    // ROI：窗口成本 / 窗口洞察数；无带单价模型（cost=null）或窗口内无洞察时为 null。
    const costPerInsight =
      costStats.totals.cost != null && board.funnel.insights > 0
        ? costStats.totals.cost / board.funnel.insights
        : null;

    return { ...board, roi: { costPerInsight } };
  }
}
