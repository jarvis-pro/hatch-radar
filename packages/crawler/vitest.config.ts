import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * crawler 纯单测（无网络 / 无 DB）：HTML 实体与标签解码等纯函数。
 * `@/*` -> src（vite 不读 tsconfig 的 paths，需手动对齐）。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
  },
});
