import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { databasePath } from '../config/env.js';

/** 全量建表 DDL（含索引），使用 CREATE TABLE IF NOT EXISTS，幂等可重复执行 */
export const DDL = `
CREATE TABLE IF NOT EXISTS posts (
  id                  TEXT PRIMARY KEY,
  source              TEXT NOT NULL DEFAULT 'reddit',
  subreddit           TEXT NOT NULL,
  title               TEXT NOT NULL,
  author              TEXT,
  selftext            TEXT NOT NULL DEFAULT '',
  url                 TEXT,
  permalink           TEXT,
  score               INTEGER NOT NULL DEFAULT 0,
  num_comments        INTEGER NOT NULL DEFAULT 0,
  created_utc         INTEGER NOT NULL,
  fetched_at          INTEGER NOT NULL,
  comment_pass        INTEGER NOT NULL DEFAULT 0,
  comments_fetched_at INTEGER,
  analyzed_at         INTEGER,
  analyze_attempts    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_posts_subreddit ON posts (subreddit);
CREATE INDEX IF NOT EXISTS idx_posts_created   ON posts (created_utc);
CREATE INDEX IF NOT EXISTS idx_posts_pending   ON posts (analyzed_at, comment_pass);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id   TEXT,
  author      TEXT,
  body        TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  depth       INTEGER NOT NULL DEFAULT 0,
  created_utc INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id);

CREATE TABLE IF NOT EXISTS insights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id       TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'reddit',
  subreddit     TEXT NOT NULL,
  post_title    TEXT NOT NULL,
  permalink     TEXT,
  model         TEXT NOT NULL,
  intensity     TEXT NOT NULL CHECK (intensity IN ('HIGH', 'MEDIUM', 'LOW')),
  pain_points   TEXT NOT NULL,
  opportunities TEXT NOT NULL,
  tags          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_post      ON insights (post_id);
CREATE INDEX IF NOT EXISTS        idx_insights_subreddit ON insights (subreddit);
CREATE INDEX IF NOT EXISTS        idx_insights_intensity ON insights (intensity);
`;

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
