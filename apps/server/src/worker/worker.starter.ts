import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { WorkerAgentService, WorkerService, type AppEnv } from '@hatch-radar/core';
import { APP_ENV } from '@/common/tokens';

/**
 * Nest 侧 worker 薄封装：启动 core 的 WorkerService（僵死回收/执行）+ WorkerAgentService（WS 连网关认领）。
 * 既装入主进程 AppModule（同进程消费,连 loopback 网关），也装入独立 worker 进程根模块。
 */
@Injectable()
export class WorkerStarter implements OnApplicationBootstrap, OnApplicationShutdown {
  private agent?: WorkerAgentService;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly worker: WorkerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.start();
    this.agent = new WorkerAgentService(this.env, this.worker);
    this.agent.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.agent?.stop();
    await this.worker.stop();
  }
}
