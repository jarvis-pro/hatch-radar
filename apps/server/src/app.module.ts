import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HttpModule } from './http/http.module';
import { logger } from './logger';
import { SchedulerModule } from './scheduler/scheduler.module';
import { WorkerModule } from './worker/worker.module';

/** 是否在主进程内同进程跑 worker（默认 true）；设 WORKER_IN_PROCESS=false 拆到独立进程 */
function workerInProcess(): boolean {
  return process.env.WORKER_IN_PROCESS?.trim() !== 'false';
}

/**
 * 主进程根模块：HTTP（导出/同步/设置/分析/健康）+ 定时调度 + （默认）同进程 worker。
 *
 * 全局模块 AppConfigModule（APP_ENV）/ DatabaseModule（PRISMA）一次导入处处可注入；
 * 各功能模块自行 import 所需 RepositoriesModule / AnalysisModule 等。
 * nestjs-pino 复用既有 pino 实例，框架日志与业务 `logger.*` 同路输出。
 */
@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: { logger, autoLogging: false } }),
    AppConfigModule,
    DatabaseModule,
    HttpModule,
    SchedulerModule,
    ...(workerInProcess() ? [WorkerModule] : []),
  ],
})
export class AppModule {}
