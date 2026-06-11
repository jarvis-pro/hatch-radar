export interface TokenBucketOptions {
  /** 每分钟放行的请求数 */
  ratePerMinute?: number;
  /** 突发容量（桶大小） */
  burst?: number;
}

interface PendingTask {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * 令牌桶请求队列：所有 Reddit 请求经由 schedule() 排队放行。
 * Reddit 免费配额为 100 次/分钟，默认 90 次/分钟 + 10 突发，留出安全余量。
 */
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

  get pending(): number {
    return this.queue.length;
  }

  /** 全局暂停放行（收到 429 时退避） */
  pause(ms: number): void {
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + ms);
    this.schedulePump();
  }

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
