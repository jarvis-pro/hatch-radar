/**
 * 首个超级管理员种子（幂等）。
 *
 * 仅当 users 表为空时，用 SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD 创建一个 super_admin，
 * 并置 must_change_password=true（首次登录强制改密）。已有任何账户则跳过——不会覆盖。
 *
 * 运行（在 migrate deploy 之后）：
 *   SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD=xxx \
 *     pnpm --filter @hatch-radar/web seed:admin
 */
import { DEFAULT_DATABASE_URL } from '@hatch-radar/config';
import { hashPassword } from '@hatch-radar/auth';
import { createDb } from '@hatch-radar/db';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function main(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('✗ 缺少 SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD 环境变量');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  const { db, close } = createDb(url);
  try {
    const count = await db.users.count();
    if (count > 0) {
      console.log(`· 已存在 ${count} 个账户，跳过种子（仅空库时创建首个超管）。`);
      return;
    }
    const now = BigInt(nowSec());
    const user = await db.users.create({
      data: {
        email,
        name: '超级管理员',
        password_hash: await hashPassword(password),
        role: 'super_admin',
        status: 'active',
        must_change_password: true,
        created_at: now,
        updated_at: now,
      },
    });
    console.log(`✓ 已创建超级管理员：${user.email}（首次登录将强制改密）`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error('✗ 种子失败：', err);
  process.exit(1);
});
