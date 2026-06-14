import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '@/config/app-config.module';
import { DatabaseModule } from '@/database/database.module';
import { logger } from '@/logger';
import { WorkerModule } from './worker.module';

/**
 * 独立 worker 进程的根模块（worker-main.ts 用 createApplicationContext 引导）。
 * 只含配置 + 数据库 + worker 池；无 HTTP、无调度——与主进程解耦，可独立扩。
 */
@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: { logger, autoLogging: false } }),
    AppConfigModule,
    DatabaseModule,
    WorkerModule,
  ],
})
export class WorkerStandaloneModule {}
