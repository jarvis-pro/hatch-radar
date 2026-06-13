import { DEFAULT_DATABASE_URL } from '@hatch-radar/config';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 配置：从 src/schema.ts 生成/应用 PostgreSQL 迁移。
 *
 * 连接串取 DATABASE_URL，缺省回退到本地 docker-compose 的 PG（见根 docker-compose.yml）。
 * `generate` 不需连库；`migrate` / `push` / `studio` 需要。
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  },
});
