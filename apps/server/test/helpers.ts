import { sql } from 'drizzle-orm';
import { createDb, runMigrations, type AppDatabase, type DbHandle } from '@hatch-radar/db';

/** 测试库连接串（与 dev 库隔离）；可用 TEST_DATABASE_URL 覆盖 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://radar:radar@localhost:5432/hatch_radar_test';

/** 打开测试库句柄并确保 schema 就绪（迁移幂等） */
export async function setupTestDb(): Promise<DbHandle> {
  const handle = createDb(TEST_DATABASE_URL);
  await runMigrations(handle.db);
  return handle;
}

/** 清空全部业务表并重置自增序列（每个用例前调用，保证互相隔离） */
export async function truncateAll(db: AppDatabase): Promise<void> {
  await db.execute(
    sql`TRUNCATE analysis_jobs, sync_ops, triage, insights, comments, posts, model_providers, app_settings RESTART IDENTITY CASCADE`,
  );
}
