import { execFileSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './helpers';

/**
 * 集成测试全局准备（vitest globalSetup，整轮测试前执行一次）。
 *
 * 用 `prisma migrate deploy` 按已提交迁移把测试库建到最新（与 dev 库隔离）。
 * 相比 `db push --force-reset`：① 规避 Prisma 7 的 AI 危险操作闸（CI / 本地都能无人值守跑）；
 * ② 顺带校验已提交迁移能否干净落库；③ 幂等——schema 已最新则空跑。
 * 用例间的数据隔离由各 spec 的 beforeEach truncateAll 负责，无需每轮重置 schema。
 */
export default function setup(): void {
  execFileSync(
    'pnpm',
    ['--filter', '@hatch-radar/db', 'exec', 'prisma', 'migrate', 'deploy'],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
  );
}
