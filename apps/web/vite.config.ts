import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite 配置（同源 SPA）。
 * - dev：监听 47080，把 /api 与 /ws 代理到 NestJS（47878），让 httpOnly cookie 同源自动带
 *   （cookieDomainRewrite 保证 Set-Cookie 在 localhost:47080 生效）。
 * - prod：`vite build` 出 dist/，由 NestJS 的 ServeStaticModule 同源托管（见 server StaticModule）。
 * - 主题 / Tailwind v4 经 postcss.config.mjs（re-export @hatch-radar/ui）处理，无需额外插件。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 47080,
    proxy: {
      '/api': {
        target: 'http://localhost:47878',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
      },
      '/ws': { target: 'ws://localhost:47878', ws: true },
    },
  },
});
