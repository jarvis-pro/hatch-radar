# hatch-radar 多端重构需求规格

> 本文件是一次较大重构的需求规格，供**新会话从零接手**。新会话无需依赖此前的对话上下文，读本文件 + 现有代码即可开工。

## 1. 背景与现状

- **项目**：`hatch-radar` —— 定时抓取 Reddit 目标版块，用 AI 提炼用户痛点与产品机会。
- **技术栈**：Node ≥20 / TypeScript（ESM）、pnpm 10 workspace、`better-sqlite3`（SQLite）、`node-cron`、`pino`、`zod`。AI 走 `@anthropic-ai/sdk`，由 `AI_PROVIDER` 在 Anthropic / DeepSeek 间选择。
- **现有结构**（`src/`）：`crawler/`（抓取）、`analyzer/`（AI 分析）、`db/`（SQLite，schema + posts/comments/insights 数据访问）、`config/`（env）、`scheduler.ts`（cron 编排）、`cli.ts`（洞察查询）、`index.ts`（入口）、`analyze-once.ts`（单次分析）。
- **数据库**：SQLite，已在 `src/db/schema.ts` 启用 **WAL 模式** + `foreign_keys=ON` + `busy_timeout=5000`。
- **workspace 现状**：根有 `pnpm-workspace.yaml`，但目前**只配了 `onlyBuiltDependencies`，还没有 `packages:` globs**（仍是单包）。

## 2. 目标

把单体后端工具，扩成 **三端协同 + 离线优先**的系统：

1. **工作台/后端**：保留爬取 + AI 分析；AI **只在服务器侧**跑（密钥不离开工作台）。新增"导出批次"与"接收移动端同步"两项能力。
2. **Web 控制台**：Next.js，读 SQLite 展示洞察，响应式，Docker 部署。
3. **RN 离线伴侣 App（iOS）**：本地优先，离线**人工研判/标注**（不在手机上跑 AI）。

## 3. 架构总览

建议改造成 monorepo（pnpm workspace），给 `pnpm-workspace.yaml` 补 `packages:`：

```
apps/
  server/    # 现有 src/ 迁移到这里：爬虫 + AI 分析 + 调度 + 导出 + 同步接收
  web/       # Next.js 控制台
  mobile/    # React Native (Expo) 离线 App
packages/
  shared/    # 共享：DB schema/类型、insight/post/comment 类型、同步协议类型
```

数据流：

```
Reddit/AI云 ──(联网)──> [apps/server 爬取+AI] ──> 服务器 SQLite(WAL)
                                                      │
                                ┌─────────────────────┼───────────────────────┐
                                ▼                      ▼                        ▼
                        [apps/web 读库展示]    导出批次(HTTP/文件)        接收同步(应用标注)
                                                      │                        ▲
                                                      ▼                        │
                                              [apps/mobile 本地 SQLite] ──确认后 push 标注──┘
```

## 4. 分模块需求

### A. 后端 / 工作台（apps/server）

- 保留现有爬取 + AI 分析能力，迁入 `apps/server`。
- **AI 只在服务器侧**：密钥（Anthropic/DeepSeek）只存工作台，绝不下发到手机。
- **新增 导出批次**：按条件筛"有效数据"（如质量达标的 insights + 关联 posts/comments），产出二选一/都做：
  - HTTP 接口供 App 在局域网拉取；
  - 导出 `.sqlite` / JSON 文件（供 AirDrop 给手机）。
- **新增 接收同步**：接受移动端上报的"操作日志"，**幂等**地应用到服务器库（见 §D）。

### B. Web 控制台（apps/web，Next.js）

- 读 SQLite，展示 insights / posts / comments，支持筛选/搜索；**响应式**。
- 用 `better-sqlite3` 读库**只能在服务端**（Server Components / Route Handlers），不可进客户端 bundle。
- 写操作（如手动触发分析）**统一走 server 进程**，Web 不直接写库（避免与爬虫抢写锁）。
- **Docker**：`next.config` 开 `output: 'standalone'` + 多阶段构建；基础镜像用 **Debian-slim（node:20-bookworm-slim），别用 Alpine**（`better-sqlite3` musl 易出问题）；SQLite 文件挂 **local volume**（WAL 不支持网络盘）。

### C. RN 离线伴侣 App（apps/mobile，建议 Expo）

- **本地优先 SQLite**：用 `op-sqlite` 或 `expo-sqlite`（与服务器同为 SQLite 文件格式，可互通）。
- **离线人工研判**：读已生成的洞察 → 打标签 / 评级 / 筛选 / 写笔记 / 改状态。**全程离线**，手机端**无 AI、无密钥**。
- **导入批次**：局域网拉服务器接口，或用 `expo-document-picker` 导入 AirDrop 来的 `.sqlite`/JSON 文件。
- **所有操作记录在本地库**（见 §D outbox）。

### D. 数据同步（local-first，手动确认 push）

- **本地优先**：手机上每次变更先写本地数据表；同时向 **outbox（操作日志表）** append 一条记录：`op_id`(客户端生成 UUID)、`type`、`target_id`、`payload`、`created_at`、`synced`。
- **同步流程**：联网（回到工作台局域网）→ App 检测未同步操作 → **提示"有 N 条待同步"** → 用户**确认** → 按序把 outbox 操作 POST 到工作台 → 服务器**幂等**应用（用 `op_id` 去重，防止重发重复应用）→ 成功后标 `synced`。
- **方向**：当前仅 **App → 工作台**（标注是增量、低冲突，无需复杂双向同步）。
- **已知开放问题**：若"工作台也独立编辑同一标注"，未来需考虑反向同步/合并策略；本期先不做。

## 5. 技术约束与坑（务必注意）

- **WAL**：仅本地文件系统可用（NFS/网络盘会损坏）；备份要带 `-wal` 或先 checkpoint。
- **better-sqlite3 是 Node 原生模块**：只用于 server/web；RN 端用 `op-sqlite`/`expo-sqlite`。两边都是标准 SQLite 文件，`.db` 可直接互通。
- **苹果账号**：真机运行需 Mac + Xcode；免费证书**每 7 天重签**，或 $99/年付费账号（可上 TestFlight/分发）。投入 App 骨架前先定。
- **密钥安全**：AI key 只在 server，绝不进 web 客户端 bundle、绝不进 mobile App。

## 6. 关键决策记录（为什么这么定）

- **原生 App 而非 PWA**：刚需是"批量导数据后离线研判、可能搁数天"。iOS PWA 存储持久性不可靠（可能被回收、`persist()` 不稳、容量受限）；原生沙盒 SQLite 持久且大容量。
- **AI 留服务器**：保证手机离线可用、密钥安全、App 简单。
- **AirDrop 仅用于"手动批量导出文件"**：它是手动 GUI 手势，无自动发送/接收 API，无头服务进程也调不动它——不能做自动管道；但"手动批量导一个文件"正是它合理的用法。
- **不用蓝牙**：带宽低、iOS 沙盒重、浏览器无 Web Bluetooth；而 LAN/手机热点已覆盖"无共享网络"场景（热点本身就是一个局域网）。

## 7. 建议实施顺序（里程碑）

1. **monorepo 重构**：`pnpm-workspace.yaml` 加 `packages:`；现有 `src/` 迁入 `apps/server`；抽 `packages/shared`（DB schema + 共享类型 + 同步协议类型）。
2. **Web 控制台**（apps/web）只读展示 + Docker 化。
3. **导出批次能力**（server：HTTP 接口 + 文件导出）。
4. **RN App 骨架**（Expo）+ 本地 SQLite + 导入批次。
5. **离线研判 UI**（标签/评级/筛选/笔记）+ 本地 outbox。
6. **同步**：App 检测→提示→确认→push；server 幂等接收。

> 建议每个里程碑独立成可运行/可验证的一步，避免一次性大爆炸式重构。
