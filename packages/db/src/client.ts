/**
 * PostgreSQL 连接工厂（node-postgres + Drizzle）与迁移执行器。
 *
 * server 取读写句柄；web 取 `readonly` 句柄（连接级 default_transaction_read_only，
 * 即便误写也被 PG 拒绝——纵深防御，对应规格「web 绝不写库」）。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

/** 应用使用的 Drizzle 数据库类型（带全表 schema，供关系查询与类型推导） */
export type AppDatabase = NodePgDatabase<typeof schema>;

/** createDb 选项 */
export interface CreateDbOptions {
  /** 只读连接：设置 default_transaction_read_only=on（web 用） */
  readonly?: boolean;
  /** 连接池上限 */
  max?: number;
}

/** 数据库句柄：drizzle 实例 + 底层连接池 + 关闭函数 */
export interface DbHandle {
  db: AppDatabase;
  pool: Pool;
  /** 关闭连接池（进程退出 / 测试清理） */
  close(): Promise<void>;
}

/**
 * 创建数据库句柄。
 * @param connectionString PG 连接串（postgres://user:pass@host:port/db）
 * @param opts 只读 / 池大小
 */
export function createDb(connectionString: string, opts: CreateDbOptions = {}): DbHandle {
  const config: PoolConfig = { connectionString };
  if (opts.max != null) config.max = opts.max;
  if (opts.readonly) config.options = '-c default_transaction_read_only=on';
  const pool = new Pool(config);
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** drizzle-kit 生成的迁移目录（.sql + journal），相对本文件解析，随包可移植 */
export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

/**
 * 应用全部未执行的迁移（幂等：drizzle 在 __drizzle_migrations 记录已执行版本）。
 * @param db 数据库实例
 * @param migrationsFolder 迁移目录，默认 {@link MIGRATIONS_DIR}
 */
export async function runMigrations(
  db: AppDatabase,
  migrationsFolder = MIGRATIONS_DIR,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
