import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '@/modules/account/auth-user.decorator';
import { SessionAuthGuard } from '@/modules/account/session-auth.guard';
import { nowSec } from '@/lib/kernel';
import { RequestLanesRepository, RequestQueueRepository, type RequestLaneRow, type RequestQueueRow } from '@/lib/db';
import { logger } from '@/logger';

/** 控制台展示的最近请求条数 */
const RECENT_LIMIT = 80;
/** lane「近期完成」统计窗口（秒） */
const RECENT_WINDOW_SEC = 3600;

function toLaneView(l: RequestLaneRow, counts?: { running: number; recent: number }) {
  return {
    lane: l.lane,
    ratePerMinute: l.rate_per_minute,
    paused: l.paused,
    running: counts?.running ?? 0,
    recent: counts?.recent ?? 0,
  };
}

function toRequestView(r: RequestQueueRow) {
  return {
    id: r.id,
    lane: r.lane,
    purpose: r.purpose,
    url: r.url,
    status: r.status,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

/**
 * /api/requests/* —— 出站请求闸控制台（鉴权 analyze:run）。
 *
 * - GET  /api/requests                  lane 概览（速率/暂停/在途/近期）+ 最近请求
 * - POST /api/requests/lanes/:lane/pause  暂停某 lane（worker 抓取阻塞至恢复）
 * - POST /api/requests/lanes/:lane/resume 恢复某 lane
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('analyze:run')
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly queue: RequestQueueRepository,
    private readonly lanes: RequestLanesRepository,
  ) {}

  @Get()
  async overview() {
    const [lanes, recent, counts] = await Promise.all([
      this.lanes.listLanes(),
      this.queue.listRecent(RECENT_LIMIT),
      this.queue.laneCounts(nowSec() - RECENT_WINDOW_SEC),
    ]);
    const countByLane = new Map(counts.map((c) => [c.lane, c]));
    return {
      lanes: lanes.map((l) => toLaneView(l, countByLane.get(l.lane))),
      recent: recent.map(toRequestView),
    };
  }

  @Post('lanes/:lane/pause')
  @HttpCode(200)
  async pause(@Param('lane') lane: string) {
    await this.lanes.setPaused(lane, true, nowSec());
    logger.info(`[请求闸] 暂停 lane=${lane}`);
    return { ok: true };
  }

  @Post('lanes/:lane/resume')
  @HttpCode(200)
  async resume(@Param('lane') lane: string) {
    await this.lanes.setPaused(lane, false, nowSec());
    logger.info(`[请求闸] 恢复 lane=${lane}`);
    return { ok: true };
  }
}
