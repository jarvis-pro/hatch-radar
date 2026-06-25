import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '@/utils/auth';
import type { AppDatabase, DbHandle } from '@/database';
import type { AppEnv } from '@/config/env';
import { UsersRepository } from '@/database';
import { SuperAdminSeeder } from '@/modules/seed/super-admin.seeder';
import { setupTestDb, truncateAll } from './helpers';

const CTX = { now: 1_700_000_000 };

/** 仅 superAdmin 字段被 SuperAdminSeeder 读取，其余 AppEnv 不涉及 */
function envWith(superAdmin: { email: string; password: string } | undefined): AppEnv {
  return { superAdmin } as unknown as AppEnv;
}

describe('SuperAdminSeeder', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let users: UsersRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    users = new UsersRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it('未设置 SUPER_ADMIN_* → skipped，不建任何账户', async () => {
    const seeder = new SuperAdminSeeder(envWith(undefined), users);
    expect((await seeder.run(CTX)).status).toBe('skipped');
    expect(await users.count()).toBe(0);
  });

  it('空库 + env 齐 → 建超管（super_admin / 强制改密 / 密码已 hash）', async () => {
    const seeder = new SuperAdminSeeder(
      envWith({ email: 'admin@example.com', password: 'pw-at-least-8' }),
      users,
    );
    expect((await seeder.run(CTX)).status).toBe('seeded');

    const view = await users.findAuthViewByEmail('admin@example.com');
    expect(view).not.toBeNull();
    expect(view!.role).toBe('super_admin');
    expect(view!.mustChangePassword).toBe(true);
    expect(await verifyPassword('pw-at-least-8', view!.passwordHash)).toBe(true);
  });

  it('users 表非空 → skipped（绝不覆盖既有账户）', async () => {
    const seeder = new SuperAdminSeeder(
      envWith({ email: 'admin@example.com', password: 'pw-at-least-8' }),
      users,
    );
    await seeder.run(CTX);
    expect((await seeder.run(CTX)).status).toBe('skipped');
    expect(await users.count()).toBe(1);
  });
});
