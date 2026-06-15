import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import type { FilterOptions, Insight, Paged } from '@hatch-radar/shared';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { DataService, parseIntensity, parsePage, trimmed } from '@hatch-radar/core';

/**
 * /api/insights/* —— 只读洞察浏览（需 insights:view）。
 * 路由声明顺序：list / filters 字面量先于 :id，避免 `filters` 被当作 id。
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('insights:view')
@Controller('insights')
export class InsightsController {
  constructor(private readonly data: DataService) {}

  /** GET /api/insights —— 分页列表，筛选 source/subreddit/intensity/q/page */
  @Get()
  list(@Query() q: Record<string, string | undefined>): Promise<Paged<Insight>> {
    return this.data.listInsights({
      source: trimmed(q.source),
      subreddit: trimmed(q.subreddit),
      intensity: parseIntensity(q.intensity),
      q: trimmed(q.q),
      page: parsePage(q.page),
    });
  }

  /** GET /api/insights/filters —— 来源 / 版块去重清单 */
  @Get('filters')
  filters(): Promise<FilterOptions> {
    return this.data.insightFilterOptions();
  }

  /** GET /api/insights/:id —— 洞察 + 研判 + 来源帖 */
  @Get(':id')
  async detail(@Param('id') idRaw: string) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundException('洞察不存在');
    const detail = await this.data.getInsightDetail(id);
    if (!detail) throw new NotFoundException('洞察不存在');
    return detail;
  }
}
