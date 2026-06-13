import { execFileSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './helpers';

/**
 * 集成测试全局准备（vitest globalSetup，整轮测试前执行一次）。
 *
 * 用 Prisma datamodel 对测试库做强制重置（drop + 按 schema.prisma 重建），与 dev 库隔离。
 * 取代原 Drizzle 的进程内 runMigrations：Prisma 7 无进程内迁移 API，schema 准备交给 CLI。
 */
export default function setup(): void {
  execFileSync(
    'pnpm',
    ['--filter', '@hatch-radar/db', 'exec', 'prisma', 'db', 'push', '--force-reset'],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
  );
}
