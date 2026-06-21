import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AwaitingPost, Paged } from '@hatch-radar/shared';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { DataService, parsePage } from '@/domain';

/**
 * /api/posts/awaiting —— 工作台「待分析」清单（「发起分析」页用，需 analyze:run）。
 * 帖子浏览 / 详情 / 评论已统一到 /api/radar/posts*（见 RadarController），旧只读端点已退役。
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('analyze:run')
@Controller('posts')
export class PostsController {
  constructor(private readonly data: DataService) {}

  /** GET /api/posts/awaiting —— 工作台待分析清单。 */
  @Get('awaiting')
  awaiting(@Query('page') page?: string): Promise<Paged<AwaitingPost>> {
    return this.data.listAwaitingManualResult(parsePage(page));
  }
}
