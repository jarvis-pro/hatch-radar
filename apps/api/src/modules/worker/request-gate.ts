import { Injectable } from '@nestjs/common';
import { RequestLanesRepository, RequestQueueRepository } from '@/database';
import { logger } from '@/logger';
import { nowSec, sleep } from '@/utils/time';
import { errMsg } from '@/utils/error';

/** 默认：lane 暂停时每 2s 轮询一次是否恢复（实际带 ±20% 抖动，避免并发协程同相位） */
const DEFAULT_PAUSE_POLL_MS = 2_000;
/** 默认：lane 持续暂停超此时长则放弃本次抓取（防无限挂起） */
const DEFAULT_MAX_PAUSE_WAIT_MS = 5 * 60_000;
/** lane 存在性缓存有效期（秒）：过期重新 ensureLane，免进程内缓存与被外部删/重置的 lane 行长期失配 */
const ENSURE_LANE_TTL_SEC = 300;

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

/** 可注入的节流参数（测试用短值；缺省回落到模块级默认常量） */
export interface RequestGateOptions {
  /** lane 暂停时的轮询间隔基值（ms，实际带 ±20% 抖动）。缺省 {@link DEFAULT_PAUSE_POLL_MS} */
  pausePollMs?: number;
  /** 单次抓取最长可被暂停的累计等待（ms），超时放弃。缺省 {@link DEFAULT_MAX_PAUSE_WAIT_MS} */
  maxPauseWaitMs?: number;
}

/**
 * 出站请求闸（worker 侧）：把每次外站抓取记入 request_queue（running→done/failed）供控制台可见，
 * 并在 lane 被暂停时阻塞放行（轮询至恢复或超时放弃）。实际限速仍由 crawler 内置令牌桶承担——
 * 闸提供「可视化 + 暂停」（设计稿 §四）；全局跨 worker 限速为后续增强。
 */
@Injectable()
export class RequestGate {
  /** lane → 上次 ensureLane 成功时刻（秒）；带 {@link ENSURE_LANE_TTL_SEC} TTL，命中即跳过打 DB */
  private readonly ensured = new Map<string, number>();
  /** lane 暂停时的轮询间隔基值（ms）；实际带 ±20% 抖动。默认 {@link DEFAULT_PAUSE_POLL_MS} */
  private readonly pausePollMs: number;
  /** 单次抓取最长可被暂停的累计等待（ms），超时放弃。默认 {@link DEFAULT_MAX_PAUSE_WAIT_MS} */
  private readonly maxPauseWaitMs: number;

  constructor(
    /** 请求流水仓储：写 running / done / failed 行供控制台可见 */
    private readonly queue: RequestQueueRepository,
    /** lane 状态仓储：ensureLane 存在性 + isPaused 暂停查询 */
    private readonly lanes: RequestLanesRepository,
    /** 可注入的节流参数（测试传短值）；缺省回落到模块级默认常量 */
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
    await this.ensureLane(req.lane); // lane 行存在（带 TTL 缓存，免每次打 DB）
    await this.waitIfPaused(req.lane); // lane 暂停则阻塞至恢复 / 超时
    // 落 running 行：放行那一刻即可见于控制台，拿到 id 用于收尾回写
    const id = await this.queue.startRequest(
      { lane: req.lane, purpose: req.purpose, url: req.url, ownerTaskId: req.ownerTaskId },
      nowSec(),
    );
    try {
      const result = await fn();
      await this.queue.finishRequest(id, 'done', null, nowSec()); // 成功收尾

      return result;
    } catch (err) {
      // 失败也必须收尾（存错因），再把异常冒泡给调用方处理重试 / 退避
      await this.queue.finishRequest(id, 'failed', errMsg(err), nowSec());
      throw err;
    }
  }

  /**
   * 确保 lane 行存在（upsert 语义）。进程内 TTL 缓存：同一 lane 在 {@link ENSURE_LANE_TTL_SEC}
   * 秒内只打一次 DB；过期重做，免缓存与被外部删 / 重置的 lane 行长期失配。
   */
  private async ensureLane(lane: string): Promise<void> {
    const now = nowSec();
    const at = this.ensured.get(lane);
    if (at != null && now - at < ENSURE_LANE_TTL_SEC) {
      return;
    }

    await this.lanes.ensureLane(lane, now);
    this.ensured.set(lane, now);
  }

  /**
   * lane 暂停时阻塞轮询至恢复；累计等待超 {@link maxPauseWaitMs} 抛错放弃本次抓取。
   * @throws 持续暂停超时
   */
  private async waitIfPaused(lane: string): Promise<void> {
    let waited = 0;
    while (await this.lanes.isPaused(lane)) {
      if (waited >= this.maxPauseWaitMs) {
        throw new Error(`请求闸 lane=${lane} 持续暂停超时，放弃本次抓取`);
      }

      if (waited === 0) {
        logger.info(`[请求闸] lane=${lane} 已暂停，等待恢复…`);
      }

      // ±20% 抖动：多个并发抓取协程不再同相位轮询，避免同时醒来打 DB、lane 恢复瞬间齐发成对外尖峰。
      const delay = this.pausePollMs * (0.8 + Math.random() * 0.4);
      await sleep(delay);
      waited += delay;
    }
  }
}
