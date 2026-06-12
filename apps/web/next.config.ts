import { join } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker 部署：构建产出自包含的 .next/standalone/**/server.js
  output: 'standalone',
  // monorepo：以仓库根为依赖追踪根，standalone 才会带上 workspace 依赖的 node_modules
  outputFileTracingRoot: join(__dirname, '../..'),
  // shared / ui 以 TS 源码形态发布（exports 指向 .ts/.tsx），需要随构建转译
  transpilePackages: ['@hatch-radar/shared', '@hatch-radar/ui'],
  // better-sqlite3 是 Node 原生模块：保持 external，仅存在于服务端运行时，绝不进客户端 bundle
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
