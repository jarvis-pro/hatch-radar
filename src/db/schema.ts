import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { databasePath } from '../config/env.js';

/** 全量建表 DDL（含索引），从 schema.sql 读取，幂等可重复执行 */
export const DDL = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');

let db: Database.Database | null = null;

function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * 打开 SQLite 数据库连接，首次调用自动创建目录、建表并运行列迁移，幂等可重复调用。
 * - 启用 WAL 模式提升并发读写性能
 * - 启用外键约束（评论随帖子级联删除）
 * @returns 全局单例数据库实例
 */
export function getDb(): Database.Database {
  if (db) return db;
  const file = resolve(databasePath());
  mkdirSync(dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(DDL);
  addColumnIfMissing(db, 'posts', 'source', `TEXT NOT NULL DEFAULT 'reddit'`);
  addColumnIfMissing(db, 'insights', 'source', `TEXT NOT NULL DEFAULT 'reddit'`);
  return db;
}

/** 关闭当前数据库连接并清空单例缓存；下次调用 getDb() 将重新打开 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// `pnpm db:migrate` 直接运行本文件
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const database = getDb();
  console.log(`数据库已就绪: ${database.name}`);
  closeDb();
}
