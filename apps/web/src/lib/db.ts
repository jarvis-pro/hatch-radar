import 'server-only';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

/**
 * 默认指向 server 包的数据文件：本地开发时 web 与 server 同仓运行。
 * Docker / 独立部署用 DATABASE_URL 覆盖（如 /data/radar.db）。
 */
const DEFAULT_DB_PATH = '../server/data/radar.db';

/** 解析数据文件绝对路径（相对路径基于 web 进程工作目录） */
export function dbFilePath(): string {
  return resolve(process.cwd(), process.env.DATABASE_URL?.trim() || DEFAULT_DB_PATH);
}

// dev 模式热更新会反复执行模块，把连接挂到 globalThis 避免句柄泄漏
const globalForDb = globalThis as unknown as { __radarDb?: Database.Database };

/**
 * 以只读模式打开数据库；文件不存在时返回 null（页面渲染引导提示，等待 server 进程建库）。
 *
 * 控制台绝不写库：写操作（爬取 / 分析 / 同步应用）统一由 server 进程执行，
 * 避免与爬虫抢 SQLite 写锁。连接只读 + busy_timeout，可与 WAL 写进程安全并存。
 */
export function tryGetDb(): Database.Database | null {
  if (globalForDb.__radarDb) return globalForDb.__radarDb;
  const file = dbFilePath();
  if (!existsSync(file)) return null;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  globalForDb.__radarDb = db;
  return db;
}
