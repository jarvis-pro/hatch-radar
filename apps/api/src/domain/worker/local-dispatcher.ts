import { Inject, Injectable } from '@nestjs/common';
import { WORKER_CONCURRENCY } from '@/common/tokens';
import { TasksRepository } from '@/lib/db';
import { logger, nowSec, type Dispatcher } from '@/lib/kernel';
import { WorkerService } from './worker.service';

/** 兜底泵周期：捡漏非 pipeline 入队的任务（检视放行 paused→queued、手动重排 failed→queued）。 */
const FALLBACK_PUMP_MS = 10_000;

/**
 * 进程内派发器（替换 WS 版 GatewayService）：在同一进程里认领任务并直接调 WorkerService 执行。
 *
 * 复刻 GatewayService 的三条语义：
 *   ① 并发上限 —— inFlight < concurrency（= 旧 pickWorker 的 activeJobs < concurrency）
 *   ② 链式补位 —— 每条任务结束后 finally 再 tryDispatch（= 旧 task_result 后的 tryDispatch）
 *   ③ 兜底周期 —— fallbackTimer（= 旧 GatewayService.fallbackTimer）
 * pumping 单飞标志杜绝并发重入导致的超发（认领循环串行化）。
 */
@Injectable()
export class LocalDispatcher implements Dispatcher {
  private inFlight = 0;
  private pumping = false;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tasks: TasksRepository,
    private readonly worker: WorkerService,
    @Inject(WORKER_CONCURRENCY) private readonly concurrency: number,
  ) {}

  /** 入队后 / 任务完成后 / 兜底周期触发：尽量把并发名额填满。 */
  async tryDispatch(): Promise<void> {
    if (this.pumping) return; // 单飞：认领循环不可并发重入
    this.pumping = true;
    try {
      while (this.inFlight < this.concurrency) {
        const task = await this.tasks.claimNextTask(nowSec());
        if (!task) break; // 队列空
        this.inFlight++;
        void this.worker
          .executeDispatchedTask(task.id)
          .catch((err: unknown) =>
            logger.error(`[dispatch] task#${task.id} 顶层异常: ${String(err)}`),
          )
          .finally(() => {
            this.inFlight--;
            void this.tryDispatch(); // 腾出名额，补位认领
          });
      }
    } finally {
      this.pumping = false;
    }
  }

  /** 起兜底泵（对应 NestJS onApplicationBootstrap）。 */
  start(): void {
    this.fallbackTimer = setInterval(() => void this.tryDispatch(), FALLBACK_PUMP_MS);
  }

  /** 停止认领新任务（对应 NestJS beforeApplicationShutdown；在途由 WorkerService.stop 排空）。 */
  stop(): void {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
  }
}
