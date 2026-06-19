import { createDb, type AppDatabase, type DbHandle } from '@hatch-radar/db';

/** 测试库连接串（与 dev 库隔离）；可用 TEST_DATABASE_URL 覆盖 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://radar:radar@localhost:47432/hatch_radar_test';

/**
 * 打开测试库句柄。schema 由 vitest globalSetup（test/global-setup.ts）
 * 用 `prisma db push --force-reset` 在整轮测试前一次性重建，这里只取连接。
 */
export function setupTestDb(): DbHandle {
  return createDb(TEST_DATABASE_URL);
}

/** 清空全部业务表并重置自增序列（每个用例前调用，保证互相隔离） */
export async function truncateAll(db: AppDatabase): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE task_stages, tasks, runs, blueprints, request_queue, request_lanes, translations, sync_ops, triage, insights, comments, posts, provider_api_keys, model_providers, sources, source_connectors, app_settings, users RESTART IDENTITY CASCADE',
  );
}
