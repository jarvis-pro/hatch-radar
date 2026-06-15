import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type AppEnv } from './env';
import { WorkerAgentService } from './worker-agent';
import { WorkerService } from './worker.service';
import { APP_ENV } from './tokens';

/**
 * Nest 侧 worker 薄封装：启动 WorkerService（僵死回收/执行）+ WorkerAgentService（WS 连 api 网关认领）。
 * 进程退出时优雅排空在途任务。
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
