import { Injectable } from '@nestjs/common';

/** TokenBucketQueue 构造参数 */
export interface TokenBucketOptions {
  /** 每分钟允许通过的请求数；默认 90，留出与 Reddit 100/min 上限的安全余量 */
  ratePerMinute?: number;
  /** 令牌桶容量（突发上限）；默认 10 */
  burst?: number;
}

/** 队列中等待出队的单个任务：保存待执行函数及其 Promise 的 settle 回调 */
interface PendingTask {
  /** 真正发起请求的无参函数，轮到且有令牌时调用 */
  run: () => Promise<unknown>;
  /** 透传 run() 成功结果到 schedule() 返回的 Promise */
  resolve: (value: unknown) => void;
  /** 透传 run() 异常到 schedule() 返回的 Promise */
  reject: (reason: unknown) => void;
}

/**
 * 令牌桶请求队列：通过 schedule() 对所有出站请求限速。
 * - 严格顺序出队，令牌不足时自动等待补充
 * - 收到 429 时可调用 pause() 全局暂停，退避结束后自动恢复
 * - 默认配置适配 Reddit API 100 次/分钟配额
 */
@Injectable()
export class TokenBucketQueue {
  /** 每毫秒补充的令牌数（= ratePerMinute / 60000） */
  private readonly refillPerMs: number;
  /** 令牌桶容量 / 突发上限，补令牌时的封顶值 */
  private readonly capacity: number;
  /** 当前可用令牌数（浮点，惰性补充时会累积小数） */
  private tokens: number;
  /** 上次补充令牌的时间戳，按与当前时刻的差值计算应补量 */
  private lastRefill = Date.now();
  /** 全局暂停的截止时刻；早于此刻不出队，0 表示未暂停 */
  private pauseUntil = 0;
  /** 严格 FIFO 的待出队任务队列 */
  private queue: PendingTask[] = [];
  /** 当前挂起的泵定时器，单飞保证同时至多一个 */
  private timer: NodeJS.Timeout | null = null;

  /**
   * @param options 速率与突发配置；省略时用默认值（90/分钟、容量 10），桶初始填满
   */
  constructor(options: TokenBucketOptions = {}) {
    const ratePerMinute = options.ratePerMinute ?? 90;
    this.capacity = options.burst ?? 10;
    this.refillPerMs = ratePerMinute / 60_000;
    this.tokens = this.capacity;
  }

  /** 当前等待出队的任务数 */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * 暂停所有出队操作指定毫秒数。
   * - 多次调用取最晚结束时刻，不会缩短已有暂停
   * @param ms 暂停时长（毫秒）
   */
  pause(ms: number): void {
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + ms);
    this.schedulePump();
  }

  /**
   * 将一次请求加入限速队列，返回其结果的 Promise。
   * @param run 执行实际网络请求的无参函数
   * @returns 与 run() 相同的结果，在令牌可用时执行
   */
  schedule<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  /**
   * 惰性补充令牌：按距上次补充的时间差增加令牌，封顶 capacity。
   * - 不依赖周期定时器，仅在 pump() 出队前现算，避免空转
   */
  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefill) * this.refillPerMs);
    this.lastRefill = now;
  }

  /**
   * 出队泵：补令牌后尽可能放行队首任务，直到令牌耗尽或队列清空。
   * - 暂停期内不放行，改为重新排程等暂停结束
   * - 放行后不 await run()，请求并发执行、Promise 结果异步透传
   * - 队列仍有剩余时自动排下一次泵等待令牌补足
   */
  private pump(): void {
    if (Date.now() < this.pauseUntil) {
      this.schedulePump();
      return;
    }
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const task = this.queue.shift()!;
      task.run().then(task.resolve, task.reject);
    }
    if (this.queue.length > 0) {
      this.schedulePump();
    }
  }

  /**
   * 安排下一次 pump()，等待时间取「暂停剩余 / 攒够 1 令牌所需 / 25ms 底线」三者最大值。
   * - 单飞：已有挂起定时器时直接返回，避免重复排程
   * - 25ms 底线防止令牌将满时空转过密
   */
  private schedulePump(): void {
    if (this.timer) return;
    const now = Date.now();
    const waitForPause = Math.max(0, this.pauseUntil - now);
    const waitForToken = this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.refillPerMs);
    const wait = Math.max(waitForPause, waitForToken, 25);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, wait);
  }
}
