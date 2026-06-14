import { join } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker 部署：构建产出自包含的 .next/standalone/**/server.js
  output: 'standalone',
  // monorepo：以仓库根为依赖追踪根，standalone 才会带上 workspace 依赖的 node_modules
  outputFileTracingRoot: join(__dirname, '../..'),
  // shared / db / ui 以 TS 源码形态发布（exports 指向 .ts/.tsx），需要随构建转译
  transpilePackages: [
    '@hatch-radar/config',
    '@hatch-radar/shared',
    '@hatch-radar/db',
    '@hatch-radar/ui',
    // 认证 crypto（Node-only，仅服务端 RSC / action / route / middleware 使用，勿进客户端组件）
    '@hatch-radar/auth',
  ],
  // pg 是服务端数据库驱动：保持 external，仅存在于服务端运行时，绝不进客户端 bundle
  serverExternalPackages: ['pg'],
};

export default nextConfig;
