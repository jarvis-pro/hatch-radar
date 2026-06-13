import 'server-only';
import { sql } from 'drizzle-orm';
import { createDb, type AppDatabase, type DbHandle } from '@hatch-radar/db';

/** 默认连接本地 docker-compose 的 PG；部署时用 DATABASE_URL 覆盖 */
const DEFAULT_DATABASE_URL = 'postgres://radar:radar@localhost:5432/hatch_radar';

/** 当前 PG 连接串 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

/** 脱敏连接目标（host/db，不含口令），仅用于「未就绪」提示展示 */
export function dbTarget(): string {
  try {
    const u = new URL(databaseUrl());
    return `${u.host}${u.pathname}`;
  } catch {
    return '(无效的 DATABASE_URL)';
  }
}

// dev 热更新会反复执行模块，把句柄挂到 globalThis 避免连接池泄漏
const globalForDb = globalThis as unknown as { __radarDb?: DbHandle };

function handle(): DbHandle {
  if (!globalForDb.__radarDb) {
    // 只读连接：连接级 default_transaction_read_only=on——控制台绝不写库，
    // 写入（爬取 / 分析 / 同步应用）统一由 server 进程执行（纵深防御）。
    globalForDb.__radarDb = createDb(databaseUrl(), { readonly: true });
  }
  return globalForDb.__radarDb;
}

/**
 * 取只读 PG 连接；连接不可用（PG 未启动 / DATABASE_URL 错误 / 未迁移）时返回 null，
 * 页面据此渲染 DbSetupNotice。
 */
export async function tryGetDb(): Promise<AppDatabase | null> {
  try {
    const { db } = handle();
    await db.execute(sql`select 1`);
    return db;
  } catch {
    return null;
  }
}
