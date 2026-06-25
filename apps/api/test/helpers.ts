import { createDb, type AppDatabase, type DbHandle } from '@/database';

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
  // rate_limit_attempts 无指向 users 的外键，故不会随 users 的 CASCADE 一并清空，须显式列出——
  // 否则登录限流计数（滑动窗）跨测试轮次残留，使阈值类用例在 15min 内重跑变红。
  await db.$executeRawUnsafe(
    'TRUNCATE task_stages, tasks, runs, processes, blueprints, request_queue, request_lanes, translations, triage, insights, comments, posts, provider_api_keys, model_providers, sources, source_connectors, app_settings, rate_limit_attempts, users RESTART IDENTITY CASCADE',
  );
}
