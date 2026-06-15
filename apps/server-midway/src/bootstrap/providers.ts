import { createDb, type AppDatabase, type DbHandle } from '@hatch-radar/db';
import { loadEnv, type AppEnv } from '@hatch-radar/core';

/**
 * 进程级单例的 AppEnv 与 Prisma 句柄（惰性建立、memo 化）。
 * loadEnv 现来自 @hatch-radar/core（领域核心）；api 在 onReady 里用 getDbHandle().db / getEnv()
 * 喂给 createCore,并以 registerObject 登记到容器。
 */

let envCache: AppEnv | undefined;
export function getEnv(): AppEnv {
  envCache ??= loadEnv();
  return envCache;
}

let handle: DbHandle | undefined;
export function getDbHandle(): DbHandle {
  if (!handle) {
    const env = getEnv();
    handle = createDb(env.databaseUrl, { max: env.databasePoolMax });
  }
  return handle;
}

export function getPrisma(): AppDatabase {
  return getDbHandle().db;
}

export async function closeDb(): Promise<void> {
  if (handle) {
    await handle.close();
    handle = undefined;
  }
}
