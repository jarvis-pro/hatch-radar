import { DDL, TRIAGE_DDL } from '@hatch-radar/shared';
import * as SQLite from 'expo-sqlite';

/**
 * 移动端专属表（叠加在共享 DDL 与 TRIAGE_DDL 之上）：
 * - outbox：操作日志（规格 §D），结构与 shared 的 OutboxRow 对应，同步推送用
 * - meta：App 级 key/value（工作台地址、设备 ID、最近导入时间等）
 */
export const MOBILE_DDL = `-- hatch-radar 移动端本地表
CREATE TABLE IF NOT EXISTS outbox (
  op_id      TEXT PRIMARY KEY,               -- 客户端生成 UUID，服务端幂等去重
  type       TEXT NOT NULL,
  target_id  INTEGER NOT NULL,
  payload    TEXT NOT NULL,                  -- JSON.stringify 后的操作内容
  created_at INTEGER NOT NULL,
  synced     INTEGER NOT NULL DEFAULT 0      -- 0=待同步 1=已同步
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox (synced, created_at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: SQLite.SQLiteDatabase | null = null;

/**
 * 打开本地数据库（documents 沙盒内 radar.db），首次调用自动建表，幂等。
 * 与服务器同为标准 SQLite 文件格式，批次 .sqlite 可直接 ATTACH 合并。
 */
export function getDb(): SQLite.SQLiteDatabase {
  if (db) return db;
  db = SQLite.openDatabaseSync('radar.db');
  db.execSync('PRAGMA journal_mode = WAL;');
  db.execSync('PRAGMA foreign_keys = ON;');
  db.execSync(DDL);
  db.execSync(TRIAGE_DDL);
  db.execSync(MOBILE_DDL);
  return db;
}

/** 读 App 级 key/value；不存在返回 null */
export function getMeta(key: string): string | null {
  const row = getDb().getFirstSync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
    key,
  ]);
  return row?.value ?? null;
}

/** 写 App 级 key/value（覆盖语义） */
export function setMeta(key: string, value: string): void {
  getDb().runSync(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
}
