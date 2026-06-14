import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  Injectable,
} from '@nestjs/common';
import { createDb, type AppDatabase, type DbHandle } from '@hatch-radar/db';
import { APP_ENV, PRISMA } from '../common/tokens';
import type { AppEnv } from '../config/env';
import { logger } from '../logger';

/** 注入令牌（内部）：数据库句柄（含连接，供优雅关闭） */
const DB_HANDLE = Symbol('DB_HANDLE');

/**
 * 启动时自检连通性 + 退出时断开连接的生命周期管理者。
 *
 * 迁移由 `dev`/`start` 脚本在进程启动前执行（`prisma migrate deploy`，见 server package.json）；
 * 这里只做一次 `select 1` 连通性探测，库不可达 / 未迁移时尽早失败并给出明确日志。
 */
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
 * 数据库模块：以 driver adapter 创建 Prisma 实例，启动时自检连通性，退出时断开。
 * 全局模块——任意 provider `@Inject(PRISMA)` 即取 Prisma 实例。
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [APP_ENV],
      useFactory: (env: AppEnv): DbHandle => createDb(env.databaseUrl),
    },
    {
      provide: PRISMA,
      inject: [DB_HANDLE],
      useFactory: (handle: DbHandle): AppDatabase => handle.db,
    },
    DatabaseLifecycle,
  ],
  exports: [PRISMA],
})
export class DatabaseModule {}
