import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { DDL, TRIAGE_DDL } from '@hatch-radar/shared';
import { databasePath } from '../config/env';

/**
 * 服务端专属表：已应用的同步操作日志（规格 §D 幂等去重依据）。
 * 每条移动端操作应用成功后在此留痕；重复推送命中 op_id 即跳过（duplicate）。
 */
const SYNC_OPS_DDL = `-- 已应用的移动端同步操作（幂等去重 + 审计）
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id      TEXT PRIMARY KEY,            -- 客户端生成的 UUID
  device_id  TEXT NOT NULL,               -- 推送设备标识
  type       TEXT NOT NULL,
  target_id  INTEGER NOT NULL,            -- 对应 insights.id
  payload    TEXT NOT NULL,               -- JSON 字符串
  created_at INTEGER NOT NULL,            -- 操作在设备上发生的时间，Unix 秒
  applied_at INTEGER NOT NULL             -- 服务端应用时间，Unix 秒
);`;

/** 当前 schema 版本（写入 PRAGMA user_version，为后续迁移留锚点） */
const SCHEMA_VERSION = 1;

/**
 * 对已存在的库补充新增列（`CREATE TABLE IF NOT EXISTS` 不会给旧表加列）。
 * - 按列存在性判断，幂等、与 user_version 无关，可重复执行
 * - 新增列：comments_changed_at（评论变更时间）、export_locked_at（导出冻结）
 */
function migrate(database: Database.Database): void {
  const cols = new Set(
    (database.pragma('table_info(posts)') as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has('comments_changed_at')) {
    database.exec(`ALTER TABLE posts ADD COLUMN comments_changed_at INTEGER`);
  }
  if (!cols.has('export_locked_at')) {
    database.exec(`ALTER TABLE posts ADD COLUMN export_locked_at INTEGER`);
  }
  database.pragma(`user_version = ${SCHEMA_VERSION}`);
}

let db: Database.Database | null = null;

/**
 * 打开 SQLite 数据库连接，首次调用自动创建目录与建表，幂等可重复调用。
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
  db.exec(TRIAGE_DDL);
  db.exec(SYNC_OPS_DDL);
  migrate(db);
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
