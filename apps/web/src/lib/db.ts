import 'server-only';
import { createDb, type AppDatabase, type DbHandle } from '@hatch-radar/db';
import { webEnv } from './env';

/** 当前 PG 连接串（经校验的 web env 切片，默认值来自 @hatch-radar/config） */
export function databaseUrl(): string {
  return webEnv().databaseUrl;
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
    // web 直连 PG 读写：简单 CRUD 直接落库、不绕 server；
    // 仅触发后台任务（爬取 / 分析队列等）才转交 server 进程执行。
    globalForDb.__radarDb = createDb(databaseUrl());
  }
  return globalForDb.__radarDb;
}

/**
 * 取 PG 连接；连接不可用（PG 未启动 / DATABASE_URL 错误 / 未迁移）时返回 null，
 * 页面据此渲染 DbSetupNotice。
 */
export async function tryGetDb(): Promise<AppDatabase | null> {
  try {
    const { db } = handle();
    await db.$queryRaw`select 1`;
    return db;
  } catch {
    return null;
  }
}

/**
 * 取读写 PG 句柄（鉴权 / 账户与设备写操作用，不做连通性预检）。
 * 连接不可用时其后续查询会抛，由调用方（登录/会话解析等）按需兜底。
 */
export function getDb(): AppDatabase {
  return handle().db;
}
