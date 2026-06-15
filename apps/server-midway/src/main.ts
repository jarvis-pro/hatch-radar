import 'reflect-metadata';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 关键：以 @swc-node/register 直跑 TS 源时，Midway 无法靠 require.extensions['.ts'] 判定 TS 环境，
// 须显式置位，否则会去找编译后的 configuration.js（导致 Main framework missing）。须在 import Bootstrap 前设置。
process.env.MIDWAY_TS_MODE = 'true';

const { Bootstrap } = await import('@midwayjs/bootstrap');

/**
 * 主进程入口（`pnpm start`）——MidwayJS 平替版，对应 NestJS 版 main.ts 的 bootstrap()。
 *
 * 以 ESM + @swc-node/register 直跑 TS 源（与 NestJS 版同一运行方式，无打包步骤），
 * 这样才能直接消费 monorepo 里以「裸 TS 源」形式发布的 @hatch-radar/* 工作区包。
 * moduleLoadType:'esm' → Midway 用 ESModuleFileDetector 以动态 import 扫描组件。
 * HTTP 监听端口由 config.default 的 koa.port（= env.HTTP_PORT）决定，绑定 0.0.0.0 见 onServerReady。
 */
const baseDir = dirname(fileURLToPath(import.meta.url));

Bootstrap.configure({
  appDir: join(baseDir, '..'),
  baseDir,
  moduleLoadType: 'esm',
}).run();
