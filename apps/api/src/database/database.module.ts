import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  Injectable,
} from '@nestjs/common';
import { createDb, type AppDatabase, type DbHandle } from './internal';
import { TxContext, makeTxAwareClient } from './tx-context';
import type { AppEnv } from '@/config/env';
import { APP_ENV, DB_HANDLE, PRISMA } from '@/common/tokens';
import { logger } from '@/logger';

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
 * 全局模块——任意 provider `@Inject(PRISMA)` 即取 Prisma 句柄；服务层注入 {@link TxContext}
 * 经 `.run()` 组合跨仓储事务。
 *
 * PRISMA 暴露为**事务感知代理**（{@link makeTxAwareClient}）：仓储照常 `@Inject(PRISMA)`，其调用在
 * `TxContext.run` 内自动落当前事务、否则走根客户端——故事务能力对 22 个仓储零改动。根句柄（DB_HANDLE）
 * 仅供 TxContext 开事务与生命周期自检 / 断开。
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [APP_ENV],
      useFactory: (env: AppEnv): DbHandle =>
        createDb(env.databaseUrl, { max: env.databasePoolMax }),
    },
    TxContext,
    {
      provide: PRISMA,
      inject: [DB_HANDLE, TxContext],
      useFactory: (handle: DbHandle, tx: TxContext): AppDatabase =>
        makeTxAwareClient(handle.db, tx.als),
    },
    DatabaseLifecycle,
  ],
  exports: [PRISMA, TxContext],
})
export class DatabaseModule {}
