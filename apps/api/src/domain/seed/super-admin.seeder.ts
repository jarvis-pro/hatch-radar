import { hashPassword } from '@/lib/auth';
import type { AppEnv } from '@/config/env';
import { UsersRepository } from '@/lib/db';
import type { Seeder, SeedContext, SeedOutcome } from './seeder';

/**
 * 首个超级管理员（幂等）：仅当 users 表空且设置了 SUPER_ADMIN_* 时创建，首登强制改密。
 * critical：配了超管却建不出来 → 无账户可登录，应 fail fast 中止启动。
 */
export class SuperAdminSeeder implements Seeder {
  readonly name = 'super-admin';
  readonly order = 20;
  readonly critical = true;

  constructor(
    private readonly env: AppEnv,
    private readonly users: UsersRepository,
  ) {}

  async run(ctx: SeedContext): Promise<SeedOutcome> {
    const sa = this.env.superAdmin;
    if (!sa) return { status: 'skipped', reason: '未设置 SUPER_ADMIN_EMAIL/PASSWORD' };
    if ((await this.users.count()) > 0) return { status: 'skipped', reason: 'users 表非空' };
    await this.users.create(
      {
        email: sa.email,
        name: '超级管理员',
        passwordHash: await hashPassword(sa.password),
        role: 'super_admin',
        mustChangePassword: true,
        createdBy: null,
        permissions: [],
        grantedBy: null,
      },
      ctx.now,
    );
    return { status: 'seeded', detail: `已创建首个超级管理员 ${sa.email}（首登强制改密）` };
  }
}
