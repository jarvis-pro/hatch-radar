# syntax=docker/dockerfile:1
# Web 控制台镜像（构建上下文 = 仓库根目录）：
#   docker build -f apps/web/Dockerfile -t hatch-radar-web .
# 规格 §B：基础镜像用 Debian-slim 而非 Alpine（better-sqlite3 在 musl 下易出问题）

# ── 构建阶段 ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
# better-sqlite3 预编译二进制下载失败时回退源码编译所需的工具链
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /repo

# 先只拷贝清单，让依赖安装层最大化命中缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @hatch-radar/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @hatch-radar/web build

# ── 运行阶段 ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=/data/radar.db

WORKDIR /app

# standalone 产物按 outputFileTracingRoot（仓库根）布局，入口在 apps/web/server.js
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static

# SQLite 数据目录：必须挂本地卷 / 绑定挂载（WAL 不支持网络盘）。
# web 进程只读数据，但 WAL 读侧仍需对 -shm 文件有创建/写权限，目录须以可写方式挂载，
# 且对容器内 node 用户（uid 1000）可读写。
VOLUME /data

EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
