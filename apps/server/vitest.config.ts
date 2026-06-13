import { defineConfig } from 'vitest/config';

/**
 * 集成测试配置：直连本地 PG（docker-compose 的 hatch_radar_test 库）。
 * - 内联 @hatch-radar/* 工作区 TS 源码（vite 默认不转译 node_modules）
 * - 串行跑文件：多文件共享同一个测试库，避免 TRUNCATE 互相打架
 * - setup 引入 reflect-metadata，供 Nest 装饰器在测试中正常工作
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: { deps: { inline: [/@hatch-radar\//] } },
  },
});
