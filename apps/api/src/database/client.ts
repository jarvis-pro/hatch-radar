/**
 * PostgreSQL 连接工厂（@prisma/adapter-pg + Prisma Client）。
 *
 * server 取读写句柄；web 取 `readonly` 句柄（连接级 default_transaction_read_only，
 * 即便误写也被 PG 拒绝——纵深防御，对应规格「web 绝不写库」）。
 *
 * Prisma 7 运行期不读 schema.prisma 的 url，连接由 driver adapter 直供：adapter 底层就是
 * `pg.Pool`，故沿用原 Drizzle 版的 `readonly` / `max` 控制（PoolConfig.options / max）。
 * 迁移不再在进程内执行（原 runMigrations 已移除），改由 CLI `prisma migrate deploy`。
 */
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from './generated/prisma/client';

/** 应用使用的 Prisma 数据库类型 */
export type AppDatabase = PrismaClient;

/** createDb 选项 */
export interface CreateDbOptions {
  /** 只读连接：设置 default_transaction_read_only=on（web 用） */
  readonly?: boolean;
  /** 连接池上限 */
  max?: number;
}

/** 数据库句柄：Prisma 实例 + 关闭函数（adapter 自管底层连接池，$disconnect 释放） */
export interface DbHandle {
  db: AppDatabase;
  /** 断开连接（进程退出 / 测试清理） */
  close(): Promise<void>;
}

/**
 * 创建数据库句柄。
 * @param connectionString PG 连接串（postgres://user:pass@host:port/db）
 * @param opts 只读 / 池大小
 */
export function createDb(connectionString: string, opts: CreateDbOptions = {}): DbHandle {
  const poolConfig: PoolConfig = { connectionString };
  if (opts.max != null) {
    poolConfig.max = opts.max;
  }

  // 连接级只读：libpq 启动参数，对该连接所有事务生效（web 纵深防御）
  if (opts.readonly) {
    poolConfig.options = '-c default_transaction_read_only=on';
  }

  const adapter = new PrismaPg(poolConfig);
  const db = new PrismaClient({ adapter });

  return { db, close: () => db.$disconnect() };
}
