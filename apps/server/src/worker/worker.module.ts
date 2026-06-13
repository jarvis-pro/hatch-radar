import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { RepositoriesModule } from '../db/repositories.module';
import { WorkerService } from './worker.service';

/**
 * Worker 模块：分析 worker 池（消费 analysis_jobs 队列）。
 * 既可装入主进程 AppModule（同进程消费），也可装入独立 worker 进程的根模块。
 */
@Module({
  imports: [RepositoriesModule, AnalysisModule],
  providers: [WorkerService],
})
export class WorkerModule {}
