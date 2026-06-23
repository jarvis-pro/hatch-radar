import {
  type BeforeApplicationShutdown,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { LocalDispatcher } from './local-dispatcher';
import { WorkerService } from './worker.service';

/**
 * Nest 侧内嵌执行器薄封装：把 core 的 WorkerService（逐环节执行 + 僵死回收）与 LocalDispatcher
 * （进程内认领派发）接入 NestJS 生命周期。单进程归一后取代旧 apps/worker 的 WorkerStarter + WS 网关。
 *
 * 关停顺序（NestJS：beforeApplicationShutdown → dispose(关 HTTP) → onApplicationShutdown）：
 * - beforeApplicationShutdown：dispatcher.stop() 先停认领**新**任务（早于关 HTTP）。
 * - onApplicationShutdown：worker.stop() 排空**在途**任务（Promise.allSettled）。
 * 无 WS 长连接，故无旧 GatewayStarter「关 HTTP 等 WS」的死锁顾虑。
 */
@Injectable()
export class WorkerStarter
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  constructor(
    // 执行器：逐环节执行 + 僵死回收（生命周期 start/stop 由本封装代调）
    private readonly worker: WorkerService,
    // 进程内派发器：认领泵（生命周期 start/stop 由本封装代调）
    private readonly dispatcher: LocalDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.start(); // 回收遗留 running + 起僵死回收定时器
    this.dispatcher.start(); // 起兜底泵
    void this.dispatcher.tryDispatch(); // 启动即捡一轮存量 queued
  }

  beforeApplicationShutdown(): void {
    this.dispatcher.stop(); // 先停认领新任务
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.stop(); // 排空在途任务
  }
}
