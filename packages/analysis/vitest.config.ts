import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * analysis 纯单测（无网络 / 无 DB / 无 AI 调用）：上下文组装里的 HTML 实体解码等纯函数。
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
