import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * kernel 纯单测（无 DB / 无 Web 框架）：加解密往返等。
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
