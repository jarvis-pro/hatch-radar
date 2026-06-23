import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  toRequestLaneRow,
  type AppDatabase,
  type RequestLanePg,
  type RequestLaneRow,
} from '../internal';

export type { RequestLaneRow };

/**
 * 出站请求 lane 配置（request_lanes）数据访问。lane 首次出现时惰性建行（默认值），
 * 暂停开关供请求闸读取以决定是否放行该 lane（详见设计稿 §四）。
 */
@Injectable()
export class RequestLanesRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 取一条 lane 配置；不存在返回 null。
   * @param lane lane 标识（reddit / hackernews / rss / ai-* 等）
   */
  async getLane(lane: string): Promise<RequestLaneRow | null> {
    const row = await this.db.request_lanes.findUnique({ where: { lane } });

    return row ? toRequestLaneRow(row) : null;
  }

  /**
   * 该 lane 是否暂停（不存在视为未暂停）。请求闸放行前读取。
   * @param lane lane 标识
   */
  async isPaused(lane: string): Promise<boolean> {
    const row = await this.db.request_lanes.findUnique({
      where: { lane },
      select: { paused: true },
    });

    return row?.paused ?? false;
  }

  /** 列出全部 lane（lane 升序），供控制台展示。 */
  async listLanes(): Promise<RequestLaneRow[]> {
    const rows = await this.db.request_lanes.findMany({ orderBy: { lane: 'asc' } });

    return rows.map((r: RequestLanePg) => toRequestLaneRow(r));
  }

  /**
   * 确保 lane 存在（首次出现以默认值建行，使其在控制台可见）。
   * @param lane lane 标识
   * @param now 当前 Unix 时间戳（秒）
   */
  async ensureLane(lane: string, now: number): Promise<void> {
    await this.db.request_lanes.upsert({
      where: { lane },
      create: { lane, updated_at: BigInt(now) },
      update: {},
    });
  }

  /**
   * 暂停 / 恢复某 lane（不存在则建行）。
   * @param lane lane 标识
   * @param paused true=暂停（请求闸不放行该 lane）；false=恢复
   * @param now 当前 Unix 时间戳（秒）
   */
  async setPaused(lane: string, paused: boolean, now: number): Promise<void> {
    await this.db.request_lanes.upsert({
      where: { lane },
      create: { lane, paused, updated_at: BigInt(now) },
      update: { paused, updated_at: BigInt(now) },
    });
  }
}
