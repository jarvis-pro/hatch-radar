/**
 * Prisma 7 CLI 配置（migrate / db pull / generate / studio 用）。
 *
 * Prisma 7 起 datasource.url 不再写在 schema.prisma 里——连接串集中到这里供 CLI 使用；
 * 运行期由 PrismaClient 的 @prisma/adapter-pg 直连，不读本文件。
 * 连接串取 DATABASE_URL，缺省回退本地 docker-compose 的 PG（与原 drizzle.config 同口径）。
 */
import { defineConfig } from 'prisma/config';
import { DEFAULT_DATABASE_URL } from '@hatch-radar/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL },
});
