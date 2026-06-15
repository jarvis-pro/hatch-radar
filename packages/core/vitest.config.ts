import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 领域核心集成测试：直连本地 PG（docker-compose 的 hatch_radar_test 库）。
 *
 * 这些用例原属 apps/server，随领域代码迁入 @hatch-radar/core 后一并搬来——
 * 测的是仓储 / 服务 / 种子等纯领域逻辑，与具体 Web 框架无关。
 * - `@/*` -> src（vite 不读 tsconfig 的 paths，需手动对齐）
 * - 内联 @hatch-radar/* 工作区 TS 源码（vite 默认不转译 node_modules）
 * - 串行跑文件：多文件共享同一测试库，避免 TRUNCATE 互相打架
 * 领域类均为普通类（无装饰器），无需 reflect-metadata，故不设 setupFiles。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: { deps: { inline: [/@hatch-radar\//] } },
  },
});
