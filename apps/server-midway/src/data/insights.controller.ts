import { Controller, Get, httpError, Inject, Param, Query, UseGuard } from '@midwayjs/core';
import { parseIntensity, parsePage, trimmed, type DataService } from '@hatch-radar/core';
import type { FilterOptions, Insight, Paged } from '@hatch-radar/shared';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { TOK } from '@/common/tokens';

/**
 * /api/insights/* —— 只读洞察浏览（需 insights:view）。
 * 路由声明顺序：list / filters 字面量先于 :id，避免 `filters` 被当作 id（与 NestJS 版一致，须保持顺序）。
 */
@UseGuard(SessionAuthGuard)
@RequirePermission('insights:view')
@Controller('/insights')
export class InsightsController {
  @Inject(TOK.data)
  data!: DataService;

  /** GET /api/insights —— 分页列表，筛选 source/subreddit/intensity/q/page */
  @Get('/')
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
  @Get('/filters')
  filters(): Promise<FilterOptions> {
    return this.data.insightFilterOptions();
  }

  /** GET /api/insights/:id —— 洞察 + 研判 + 来源帖 */
  @Get('/:id')
  async detail(@Param('id') idRaw: string) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) throw new httpError.NotFoundError('洞察不存在');
    const detail = await this.data.getInsightDetail(id);
    if (!detail) throw new httpError.NotFoundError('洞察不存在');
    return detail;
  }
}
