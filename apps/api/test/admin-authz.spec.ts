import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditLogsRepository,
  DeviceCredentialsRepository,
  DeviceEnrollmentsRepository,
  SessionsRepository,
  UsersRepository,
  type AppDatabase,
  type DbHandle,
} from '@/database';
import { AdminService } from '@/modules/admin/admin.service';
import { hashPassword } from '@/auth';
import { nowSec } from '@/utils/time';
import type { PermissionKey, UserRole } from '@hatch-radar/shared';
import type { AuthedUser } from '@/modules/account/auth-context';
import { setupTestDb, truncateAll } from './helpers';

/** 构造一个 actor 上下文（无需真实会话）。 */
function authed(id: string, role: UserRole, permissions: PermissionKey[] = []): AuthedUser {
  return {
    id,
    email: `${id}@t.co`,
    name: id,
    avatar: null,
    role,
    status: 'active',
    mustChangePassword: false,
    permissions,
    sessionId: `s-${id}`,
  };
}

/**
 * AdminService 越权矩阵（#3）：持 accounts:manage 的普通管理员不可操作其它账户（含平级管理员），
 * 仅可操作自己；超级管理员可操作任何账户。守住「重置平级密码接管账户」这一越权。
 */
describe('AdminService 越权矩阵', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let admin: AdminService;
  let users: UsersRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    users = new UsersRepository(db);
    admin = new AdminService(
      users,
      new SessionsRepository(db),
      new DeviceCredentialsRepository(db),
      new DeviceEnrollmentsRepository(db),
      new AuditLogsRepository(db),
    );
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  async function seed(role: UserRole, permissions: PermissionKey[] = []): Promise<string> {
    return users.create(
      {
        email: `${role}-${Math.round(performance.now())}@t.co`,
        name: 'u',
        passwordHash: await hashPassword('pw12345678'),
        role,
        mustChangePassword: false,
        createdBy: null,
        permissions,
        grantedBy: null,
      },
      nowSec(),
    );
  }

  it('普通管理员重置 / 停用 / 删除 / 编辑其它管理员一律 403', async () => {
    const aId = await seed('admin', ['accounts:manage']);
    const bId = await seed('admin', ['insights:view']);
    const actorA = authed(aId, 'admin', ['accounts:manage']);
    const msg = '只有超级管理员能管理其它账户';
    await expect(admin.resetPassword(actorA, bId)).rejects.toThrow(msg);
    await expect(admin.setStatus(actorA, bId, 'disabled')).rejects.toThrow(msg);
    await expect(admin.deleteUser(actorA, bId)).rejects.toThrow(msg);
    await expect(
      admin.editUser(actorA, bId, { name: 'x', role: 'admin', perms: [] }),
    ).rejects.toThrow(msg);
  });

  it('超级管理员可重置普通管理员密码', async () => {
    const superId = await seed('super_admin');
    const bId = await seed('admin', ['insights:view']);
    const res = await admin.resetPassword(authed(superId, 'super_admin'), bId);
    expect(res.tempPassword).toEqual(expect.any(String));
  });

  it('普通管理员可编辑自己（改名）', async () => {
    const aId = await seed('admin', ['accounts:manage']);
    await expect(
      admin.editUser(authed(aId, 'admin', ['accounts:manage']), aId, {
        name: '新名',
        role: 'admin',
        perms: ['accounts:manage'],
      }),
    ).resolves.toBeUndefined();
  });
});
