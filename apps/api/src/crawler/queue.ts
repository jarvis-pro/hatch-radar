import { Injectable } from '@nestjs/common';

/** TokenBucketQueue 构造参数 */
export interface TokenBucketOptions {
  /** 每分钟允许通过的请求数；默认 90，留出与 Reddit 100/min 上限的安全余量 */
  ratePerMinute?: number;
  /** 令牌桶容量（突发上限）；默认 10 */
  burst?: number;
}

interface PendingTask {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
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
  private readonly refillPerMs: number;
  private readonly capacity: number;
  private tokens: number;
  private lastRefill = Date.now();
  private pauseUntil = 0;
  private queue: PendingTask[] = [];
  private timer: NodeJS.Timeout | null = null;

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

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefill) * this.refillPerMs);
    this.lastRefill = now;
  }

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
