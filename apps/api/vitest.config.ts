import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };

/**
 * 集成测试配置：直连本地 PG（docker-compose 的 hatch_radar_test 库）。
 * - 内联 @hatch-radar/* 工作区 TS 源码（vite 默认不转译 node_modules）
 * - 串行跑文件：多文件共享同一个测试库，避免 TRUNCATE 互相打架
 * - setup 引入 reflect-metadata，供 Nest 装饰器在测试中正常工作
 */
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Vite 不读 tsconfig 的 paths，需手动对齐 @/* -> src（与 tsconfig.json 保持一致）
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
    // 测试期闭掉应用日志（pino silent）：失败路径用例会故意打 ERROR/WARN、服务亦有大量 INFO 流水，
    // 静音后 pass/fail 一目了然；调试某用例时临时改 'debug' 再跑即可。
    env: { LOG_LEVEL: 'silent' },
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: { deps: { inline: [/@hatch-radar\//] } },
  },
});
