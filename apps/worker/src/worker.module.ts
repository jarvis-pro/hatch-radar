import {
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { createDb, type AppDatabase, type DbHandle } from '@hatch-radar/db';
import { loadEnv, logger, type AppEnv } from '@hatch-radar/kernel';
import { createWorkerCore } from './assembly';
import { APP_ENV, PRISMA } from './tokens';
import { WorkerService } from './worker.service';
import { WorkerStarter } from './worker.starter';

/** 内部令牌：数据库句柄（含连接，供优雅关闭） */
const DB_HANDLE = Symbol('DB_HANDLE');

/** 启动自检连通性 + 退出断连（迁移由 api 的 dev/start 脚本负责，worker 只探测） */
@Injectable()
class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onModuleInit(): Promise<void> {
    await this.handle.db.$queryRaw`select 1`;
    logger.info('[db] PostgreSQL 连接就绪');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

/**
 * 独立 worker 进程根模块（main.ts 用 createApplicationContext 引导，无 HTTP）。
 * env 由 `--env-file-if-exists` 注入 process.env 后 loadEnv 校验；PRISMA 自建连接；
 * WorkerService 经 {@link createWorkerCore} 装配；WorkerStarter 管生命周期。
 */
@Module({
  imports: [LoggerModule.forRoot({ pinoHttp: { logger, autoLogging: false } })],
  providers: [
    { provide: APP_ENV, useFactory: (): AppEnv => loadEnv() },
    {
      provide: DB_HANDLE,
      inject: [APP_ENV],
      useFactory: (env: AppEnv): DbHandle => createDb(env.databaseUrl, { max: env.databasePoolMax }),
    },
    { provide: PRISMA, inject: [DB_HANDLE], useFactory: (handle: DbHandle): AppDatabase => handle.db },
    {
      provide: WorkerService,
      inject: [PRISMA],
      useFactory: (db: AppDatabase): WorkerService => createWorkerCore(db).worker,
    },
    DatabaseLifecycle,
    WorkerStarter,
  ],
})
export class WorkerModule {}
