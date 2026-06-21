# syntax=docker/dockerfile:1
#
# hatch-radar 后端镜像（单进程后端 api；启动命令由 docker-compose 指定）。
#
# 本项目按既定方式「跑 TS 源」（@swc-node/register，不打包），故 @swc/core、typescript、
# vite 等 devDependencies 是运行/构建期必需——镜像不剥离 devDeps、保留构建工具链。
# 单阶段优先「一次跑通」；若要瘦身可拆 builder/runner 多阶段（运行期仍须保留 node_modules）。
# web 控制台（vite build 产物）一并构建进镜像，由 api 的 serve-static 同源托管（单一部署物）。

FROM node:22-bookworm-slim

# better-sqlite3 等原生模块编译需 python3 + C/C++ 工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# 锁定 package.json 指定的 pnpm 版本（build 时备好，运行期不再联网拉取）
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app

# ① 依赖层：只 copy 安装清单（+ prisma schema 供 db 包 postinstall 的 prisma generate）。
#    源码未变时此层命中缓存、免重装。--frozen-lockfile 要求 workspace 清单与 lockfile 一致，
#    故所有成员的 package.json（含 mobile）都要 copy；但 --filter 只装 api/web 子树，
#    跳过 mobile 的 Expo 重依赖。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json          apps/api/
COPY apps/web/package.json          apps/web/
COPY apps/mobile/package.json       apps/mobile/
COPY packages/analysis/package.json packages/analysis/
COPY packages/auth/package.json     packages/auth/
COPY packages/config/package.json   packages/config/
COPY packages/crawler/package.json  packages/crawler/
COPY packages/db/package.json       packages/db/
COPY packages/kernel/package.json   packages/kernel/
COPY packages/shared/package.json   packages/shared/
COPY packages/ui/package.json       packages/ui/
COPY packages/db/prisma             packages/db/prisma
RUN pnpm install --frozen-lockfile \
      --filter "@hatch-radar/api..." \
      --filter "@hatch-radar/web..."

# ② 源码层：copy 全部源码，对齐 schema 重新生成 prisma client，构建 web SPA（出 apps/web/dist）
COPY . .
RUN pnpm db:generate && pnpm build:web

ENV NODE_ENV=production

# api（pnpm start:api）：启动前 prisma migrate deploy → HTTP 监听 0.0.0.0:47878 + 内嵌任务执行 + 同源托管 web。
CMD ["pnpm", "start:api"]
