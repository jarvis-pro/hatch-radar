import { Module } from '@nestjs/common';
import { AnalysisModule } from '@/analysis/analysis.module';
import { RuntimeSettingsModule } from '@/config/runtime-settings.module';
import { RepositoriesModule } from '@/db/repositories.module';
import { WorkerAgentService } from './worker-agent.service';
import { WorkerService } from './worker.service';

/**
 * Worker 模块：分析 job 执行器 + Gateway WS 客户端。
 * 既可装入主进程 AppModule（同进程消费），也可装入独立 worker 进程的根模块。
 */
@Module({
  imports: [RepositoriesModule, AnalysisModule, RuntimeSettingsModule],
  providers: [WorkerService, WorkerAgentService],
})
export class WorkerModule {}
