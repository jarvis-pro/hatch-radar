import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createDb, runMigrations, type AppDatabase, type DbHandle } from '@hatch-radar/db';
import { APP_ENV, DRIZZLE } from '../common/tokens';
import type { AppEnv } from '../config/env';

/** 注入令牌（内部）：数据库句柄（含连接池，供优雅关闭） */
const DB_HANDLE = Symbol('DB_HANDLE');

/**
 * 启动时应用迁移 + 退出时关闭连接池的生命周期管理者。
 * 迁移幂等（drizzle 记录已执行版本），多进程/重启重复执行安全。
 */
@Injectable()
class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Database');
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onModuleInit(): Promise<void> {
    await runMigrations(this.handle.db);
    this.logger.log('PostgreSQL 迁移已应用（schema 就绪）');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

/**
 * 数据库模块：以连接池创建 Drizzle 实例，启动时跑迁移，退出时关池。
 * 全局模块——任意 provider `@Inject(DRIZZLE)` 即取异步 Drizzle 实例。
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
      provide: DRIZZLE,
      inject: [DB_HANDLE],
      useFactory: (handle: DbHandle): AppDatabase => handle.db,
    },
    DatabaseLifecycle,
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
