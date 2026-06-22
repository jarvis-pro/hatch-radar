---
name: db-migrate
description: 改了 apps/api 的 Prisma schema 后，按本仓 Prisma 7 约定建并应用数据库迁移。适用场景：用户说"建迁移"、"加字段/加表/加枚举值后迁移"、"改 schema 后迁移"、"create migration"、"migrate"、"改数据库结构"，或刚编辑过 apps/api/prisma/schema.prisma 需要落库。走 db:migrate:dev（必带 --name，否则卡交互）+ 重启 api（否则内存用旧 client）；绝不用 db push 改结构。
user-invocable: true
---

# /db-migrate — 建并应用 Prisma 迁移

改了 `apps/api/prisma/schema.prisma`（加表 / 改字段 / 加枚举值 / 改索引）后，把改动落成一条迁移、应用到本地 dev 库、并让 api 用上新 client。

用户参数：`$ARGUMENTS`（可选，作为迁移名或改动意图的提示）。

---

## 前置

- **本地 PG 必须在跑**：`docker compose up -d db`（dev 库 `hatch_radar` @ `localhost:47432`）。迁移连真库。
- **命令只在 `apps/api` 工作区有**：根 `package.json` 不代理 `db:migrate:dev`，必须用 `--filter @hatch-radar/api`。

## 流程

### 1. 看改动起名

```bash
git diff apps/api/prisma/schema.prisma
```

据 diff 想一个 snake_case 迁移名（见下方命名约定）。改动为空就停下，不建空迁移。

### 2. 建并应用迁移（必带 --name）

```bash
pnpm --filter @hatch-radar/api db:migrate:dev --name <snake_case_描述>
```

- **必须带 `--name`**：省略会卡在 Prisma 交互式命名提示（本环境无法应答 → 挂起）。
- 这一步**顺带 `prisma generate`** 重新生成 client（`apps/api/src/lib/db/generated/prisma`）。
- 迁移 SQL 落 `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`。

### 3. 重启 api 进程

api 把生成的 client **载入内存**，不重启会继续用旧枚举 / 旧字段（典型报错 `Value 'xxx' not found in enum 'yyy'`）。

- `dev:api` 带 `node --watch`，client 重新生成后**通常会自动重启**——确认它真重启了；没有就手动重启。
- 没在跑 `dev:api` 则下次启动自带新 client，无需额外动作。

### 4. 验证

```bash
pnpm --filter @hatch-radar/api typecheck   # 域类型 / mappers.ts 对得上新 schema
```

必要时 `pnpm db:studio` 核对表结构。

---

## 命名约定

snake_case、动词开头、说「加了啥 / 为什么」，不说「改了表」：

- `add_paused_to_job_status`
- `add_translations_table`
- `index_posts_created_at`

## 遇到这些停下问用户（不要自动确认）

- CLI 提示**会丢数据**（drop column / 需要 reset / data loss warning）——贴出提示，问用户，**不要**自动回车确认。
- 报 **shadow database** / **drift** 错——贴错误原文，别强推。

## 红线

- ❌ `pnpm db:push` / `prisma db push` 改结构——有 AI 同意闸、且不留迁移历史；结构变更一律走 `db:migrate:dev`。
- ❌ 省略 `--name`——会卡交互提示。
- ❌ 手改 `prisma/migrations/` 下**已应用**的迁移 SQL——要改就改 schema 再生成**新**迁移。
- ❌ 编辑 `src/lib/db/generated/prisma`——它是 `generate` 的产物，改了会被覆盖。
- ❌ 改完不重启 api 就跑 / 测——内存里还是旧 client。
