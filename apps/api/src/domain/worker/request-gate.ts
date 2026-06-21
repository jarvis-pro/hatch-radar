import { Injectable } from '@nestjs/common';
import { RequestLanesRepository, RequestQueueRepository } from '@/lib/db';
import { logger, nowSec } from '@/lib/kernel';

/** 默认：lane 暂停时每 2s 轮询一次是否恢复 */
const DEFAULT_PAUSE_POLL_MS = 2_000;
/** 默认：lane 持续暂停超此时长则放弃本次抓取（防无限挂起） */
const DEFAULT_MAX_PAUSE_WAIT_MS = 5 * 60_000;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一次出站请求的描述（用于落库展示与归属） */
export interface GateRequest {
  /** 限速分组：reddit | hackernews | rss */
  lane: string;
  /** 用途：listing | comments */
  purpose: string;
  /** 请求标识（r/SaaS/hot、帖子 id 等） */
  url?: string;
  /** 关联任务 id */
  ownerTaskId?: number | null;
}

/** 可注入的节流参数（测试用短值） */
export interface RequestGateOptions {
  pausePollMs?: number;
  maxPauseWaitMs?: number;
}

/**
 * 出站请求闸（worker 侧）：把每次外站抓取记入 request_queue（running→done/failed）供控制台可见，
 * 并在 lane 被暂停时阻塞放行（轮询至恢复或超时放弃）。实际限速仍由 crawler 内置令牌桶承担——
 * 闸提供「可视化 + 暂停」（设计稿 §四）；全局跨 worker 限速为后续增强。
 */
@Injectable()
export class RequestGate {
  private readonly ensured = new Set<string>();
  private readonly pausePollMs: number;
  private readonly maxPauseWaitMs: number;

  constructor(
    private readonly queue: RequestQueueRepository,
    private readonly lanes: RequestLanesRepository,
    options: RequestGateOptions = {},
  ) {
    this.pausePollMs = options.pausePollMs ?? DEFAULT_PAUSE_POLL_MS;
    this.maxPauseWaitMs = options.maxPauseWaitMs ?? DEFAULT_MAX_PAUSE_WAIT_MS;
  }

  /**
   * 经闸执行一次外站请求：确保 lane 存在 → lane 暂停则等待 → 记 running → 执行 → 记 done/failed。
   * @throws lane 持续暂停超时，或 fn 抛错（记 failed 后冒泡）
   */
  async run<T>(req: GateRequest, fn: () => Promise<T>): Promise<T> {
    await this.ensureLane(req.lane);
    await this.waitIfPaused(req.lane);
    const id = await this.queue.startRequest(
      { lane: req.lane, purpose: req.purpose, url: req.url, ownerTaskId: req.ownerTaskId },
      nowSec(),
    );
    try {
      const result = await fn();
      await this.queue.finishRequest(id, 'done', null, nowSec());
      return result;
    } catch (err) {
      await this.queue.finishRequest(id, 'failed', errMsg(err), nowSec());
      throw err;
    }
  }

  private async ensureLane(lane: string): Promise<void> {
    if (this.ensured.has(lane)) return;
    await this.lanes.ensureLane(lane, nowSec());
    this.ensured.add(lane);
  }

  private async waitIfPaused(lane: string): Promise<void> {
    let waited = 0;
    while (await this.lanes.isPaused(lane)) {
      if (waited >= this.maxPauseWaitMs) {
        throw new Error(`请求闸 lane=${lane} 持续暂停超时，放弃本次抓取`);
      }
      if (waited === 0) logger.info(`[请求闸] lane=${lane} 已暂停，等待恢复…`);
      await sleep(this.pausePollMs);
      waited += this.pausePollMs;
    }
  }
}
