/**
 * Prisma 7 CLI 配置（migrate / db pull / generate / studio 用）。
 *
 * Prisma 7 起 datasource.url 不再写在 schema.prisma 里——连接串集中到这里供 CLI 使用；
 * 运行期由 PrismaClient 的 @prisma/adapter-pg 直连，不读本文件。
 * 连接串取 DATABASE_URL，缺省回退本地 docker-compose 的 PG（与原 drizzle.config 同口径）。
 */
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';
import { DEFAULT_DATABASE_URL } from '@hatch-radar/config';

// CLI 场景（migrate / db pull / ...）prisma 不自动读 .env：手动加载工作区根 .env，
// 使迁移用的 DATABASE_URL 与 api / worker 同源（脚本 CWD 为 packages/db，../../.env 即仓库根）。
// 已存在的 OS env 不会被覆盖（process.loadEnvFile 与 --env-file 同口径）。
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL },
});
