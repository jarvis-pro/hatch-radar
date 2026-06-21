import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  toRequestQueueRow,
  type AppDatabase,
  type RequestQueuePg,
  type RequestQueueRow,
} from '../internal';

export type { RequestQueueRow };

/** 错误信息落库长度上限 */
const MAX_ERROR_CHARS = 500;

/** 新建一条出站请求记录的入参 */
export interface NewRequest {
  /** 限速分组：reddit | hackernews | rss | ai-* */
  lane: string;
  /** 用途：listing | comments | … */
  purpose: string;
  /** 请求标识（如 r/SaaS/hot、帖子 id） */
  url?: string;
  /** 关联任务（供回看哪条任务发的请求） */
  ownerTaskId?: number | null;
}

/**
 * 出站请求队列（request_queue）数据访问：每条外站请求记一行（running→done/failed），
 * 供请求闸控制台展示「执行计划 / 历史」与排查。详见设计稿 §四。
 */
@Injectable()
export class RequestQueueRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /** 开始一条请求（status=running），返回 id。请求闸在真正发请求前调用。 */
  async startRequest(input: NewRequest, now: number): Promise<number> {
    const row = await this.db.request_queue.create({
      data: {
        lane: input.lane,
        url: input.url ?? '',
        purpose: input.purpose,
        owner_task_id: input.ownerTaskId ?? null,
        status: 'running',
        scheduled_at: BigInt(now),
        enqueued_at: BigInt(now),
        started_at: BigInt(now),
      },
    });
    return row.id;
  }

  /** 收尾一条请求（done / failed）+ 结束时间 + 可选错误。 */
  async finishRequest(
    id: number,
    status: 'done' | 'failed',
    error: string | null,
    now: number,
  ): Promise<void> {
    await this.db.request_queue.update({
      where: { id },
      data: {
        status,
        error: error ? error.slice(0, MAX_ERROR_CHARS) : null,
        finished_at: BigInt(now),
      },
    });
  }

  /** 最近请求（id 倒序），供控制台展示。 */
  async listRecent(limit: number): Promise<RequestQueueRow[]> {
    const rows = await this.db.request_queue.findMany({ orderBy: { id: 'desc' }, take: limit });
    return rows.map((r: RequestQueuePg) => toRequestQueueRow(r));
  }

  /** 按 lane 统计在途（running）+ 最近一小时完成数，供控制台 lane 概览。 */
  async laneCounts(sinceSec: number): Promise<{ lane: string; running: number; recent: number }[]> {
    return this.db.$queryRaw<{ lane: string; running: number; recent: number }[]>`
      SELECT lane,
             count(*) FILTER (WHERE status = 'running')::int AS running,
             count(*) FILTER (WHERE finished_at >= ${sinceSec})::int AS recent
      FROM request_queue
      GROUP BY lane
    `;
  }
}
