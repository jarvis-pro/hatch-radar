# 后端归一重构（web 纯前端 / server 单一后端 + 鉴权权威）

> 把散在 web 与 server 两侧的「业务逻辑 + 数据访问 + 鉴权」收敛成单一后端：
> **Next.js（apps/web）退成纯前端/BFF——不再直连 PG、不再有业务逻辑**；
> **NestJS（apps/server）成为唯一后端——唯一 DB 写入方 + 唯一鉴权权威**。
> 人用会话、mobile 用设备签名，都在 server 一处校验；`API_TOKEN` 机器平面与「局域网信任」特判随之消失。
> 本文是落地前的设计方案。

- **状态**：✅ 已落地（分支 `refactor/backend-consolidation`，2026-06-15）——server 成为单一后端 + 鉴权权威，web 退为 Vite SPA 由 server 同源托管，`API_TOKEN` HTTP 平面退役；全量 typecheck / 37 测试 / SPA build / 同源 boot 冒烟均通过。
- **日期**：2026-06-15
- **前端形态**：已定改 **Vite + React Router 同源 SPA**（见 [[frontend-spa-migration-design]]）——这简化本文 K3/K4/§4.2/§6：SPA 与 `/api` 同源，httpOnly `radar_session` cookie 自动随请求发，**无 BFF / 无 Bearer 转发 / 无 SSR 跳，server 端到端持 cookie**。
- **范围**：`apps/web`（去 PG 直连 / 去鉴权与账户业务，改为 server API 客户端）、`apps/server`（新增账户/会话/管理/只读数据模块 + 会话守卫）、`packages/db`（补 users/sessions 等 repository）、`packages/auth`/`packages/shared`（基本不动）
- **不在范围**：mobile 端（设备签名鉴权已在 server，不变）；具体 UI 视觉改版
- **取代 / 修订**：[[web-write-convention]]（"web 直接写 PG"）整体反转；[[account-rbac-design]] §3 信任平面、§8 校验落点、§9 机器平面——本文把 web 的人鉴权收进 server，原"web 数据层强制 + 机器令牌桥接"被"server 单一会话权威"取代

---

## 1. 背景：复杂度来自「架构 split」，不是鉴权本身

现状是一个**双写后端**——两套代码各自连同一个 PostgreSQL：

| 谁                        | 干了什么                                                                                        | 鉴权落点                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **apps/web**（Next.js）   | **直连 PG 读写**：登录/会话/限流、账户·设备·权限 CRUD、审计写入、洞察/帖子/评论/triage 浏览查询 | 人：cookie 会话 + `requirePermission`，**在 web 数据层强制** |
| **apps/server**（NestJS） | 爬取 / AI 分析 / 队列 / 调度 / WS 网关 / mobile sync·export                                     | 机器：`API_TOKEN`（web 代理）；设备：Ed25519 签名（mobile）  |

「鉴权好复杂」的根因就是这个 split：人鉴权在 **web 层**，机器/设备鉴权在 **server 层**，中间靠共享 `API_TOKEN` 把两个进程粘起来（[[runtime-config-design]] 收口时讨论过的「机器平面残留」）。只要 web 还自带一套人鉴权 + 直连 PG，就必然有「两个权威、一条机器桥」。

> 现状关键事实（探查所得）：
>
> - web 直连 PG 的数据访问层 [lib/db.ts](apps/web/src/lib/db.ts)（**读写**，非只读）；查询集中在 [lib/queries.ts](apps/web/src/lib/queries.ts)、账户在 [lib/auth/\*](apps/web/src/lib/auth)、[lib/admin/\*](apps/web/src/lib/admin)。
> - server **完全没有「登录的人」概念**：`BearerAuthGuard` 只认 `API_TOKEN`，`MachineOrDeviceGuard` 认设备签名或 `API_TOKEN`；全 server 无一处读 `sessions` 表。
> - 鉴权 crypto 已在 [packages/auth](packages/auth)（密码 scrypt / 会话 token / Ed25519），能力目录已在 [packages/shared](packages/shared/src/permissions.ts)——**两个包 web/server 共用，基本不用动**。
> - web 已经只代理（不直连）的部分：`/api/settings`、`/api/sources`、`/api/source-connectors`、`/api/analysis`、`/api/export`。

---

## 2. 目标架构

```
浏览器 ──密码登录──▶ Next.js(纯前端/BFF) ──转发用户会话 token──▶ NestJS(唯一后端) ──▶ PostgreSQL
   ▲  radar_session cookie（web 持有 cookie 机制）         │  会话/设备一处校验 + 一处写库
   └────────────────── 页面/数据全部来自 server API ───────┘
mobile ──设备 Ed25519 签名──────────────────────────────────▶ NestJS
```

- **server = 唯一 DB 写入方 + 唯一鉴权权威**：所有业务读写、会话签发/校验、账户/设备/权限/审计都在 server。
- **web = 纯前端**：渲染 UI + 持有 `radar_session` cookie；每个请求把会话 token 转给 server，由 server 校验并返回用户态；**零 PG 访问、零业务逻辑、零 RBAC 强制**（只用能力目录做 UI 显隐）。
- **一套鉴权模型，一处强制**：人=会话、mobile=设备签名，统一在 server 的守卫里校验 + 查权限。
- **`API_TOKEN` 机器平面退场**：web→server 这一跳带的是**人的会话 token**（server 验），不再是共享机器密钥；「局域网信任 / 非回环特判」一并删除——鉴权恒开、fail-closed，网络位置与应用逻辑无关（呼应上轮「就当普通网络」）。

---

## 3. 核心设计决策摘要

| #   | 决策                | 取值                                                                                                                                   | 来源                                             |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| K1  | 唯一后端            | server 承接全部服务端业务；web 退纯前端（不直连 PG）                                                                                   | 用户拍板                                         |
| K2  | 鉴权权威            | **server 唯一**：签发/校验会话 + 校验设备签名 + 查权限，都在 server                                                                    | 用户拍板                                         |
| K3  | web→server 凭据载体 | **同源 httpOnly cookie 自动带**（前端改 Vite SPA、由 NestJS 同源托管）；无需 Bearer 转发/BFF。server `SessionAuthGuard` 读 cookie 校验 | 用户拍板（见 [[frontend-spa-migration-design]]） |
| K4  | cookie 机制         | **server 端到端**：登录 `Set-Cookie: radar_session`（HttpOnly），每请求读 cookie 校验；SPA 永不接触 token                              | 用户拍板                                         |
| K5  | `API_TOKEN`         | HTTP 通道**退场**（被会话取代）；仅 worker↔gateway 内部 WS 可选保留一个内部令牌（或靠私网绑定）                                        | 推荐（见 §9 O2）                                 |
| K6  | LAN 特判            | 删除「未配 token 即放行」与 `NODE_ENV==='production'` 特判；守卫 fail-closed，鉴权恒开                                                 | 用户拍板（上轮）                                 |
| K7  | 共享包              | `packages/auth`（crypto）、`packages/shared`（能力目录）**不动**，server 直接复用                                                      | 复用现状                                         |
| K8  | 落地节奏            | 分期：P0 鉴权权威归 server（吃掉复杂度）→ P1 只读端点搬迁 → P2 写端点+去 web 直连 → P3 清理退役                                        | 推荐                                             |
| K9  | mobile              | 不变（设备签名直连 server）；仅 sync/export 守卫把 `API_TOKEN` 兜底换成「会话或设备」                                                  | 推荐                                             |

---

## 4. 鉴权收敛（这是化解复杂度的核心）

### 4.1 会话生命周期搬到 server

web 现有的会话逻辑（[lib/auth/session.ts](apps/web/src/lib/auth/session.ts)、[actions.ts](apps/web/src/lib/auth/actions.ts)、[throttle.ts](apps/web/src/lib/auth/throttle.ts)）**整体移到 server**，行为不变、只换执行方：

| 动作              | 现状（web 直连 PG）                              | 目标（server 端点）                                                        |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| 登录              | `loginAction`：限流→验密码→建会话→写 cookie→审计 | `POST /api/auth/login`：限流→验密码→建会话→**回 token**；web 据此设 cookie |
| 校验              | `resolveSession`：查 sessions+users、滑动续期    | `GET /api/auth/session`：验 token→返回用户态（含权限）+ 滑动续期           |
| 登出              | `logoutAction`：删会话行+清 cookie               | `POST /api/auth/logout`：删会话行；web 清 cookie                           |
| 改密              | `changePasswordAction`：验旧→改→踢其余会话       | `POST /api/auth/change-password`                                           |
| 我的会话/登出其他 | `listUserSessions` / `revokeOtherSessions`       | `GET /api/auth/sessions`、`DELETE /api/auth/sessions/:id`                  |

### 4.2 每请求的鉴权（web 转发 + server 校验）

```
浏览器(SPA) → server：同源 fetch /api/*，浏览器自动带 httpOnly radar_session cookie
server SessionAuthGuard：sha256(cookie token) 查 sessions → 校验未过期 + user active → 加载权限 → req.user
                         无效/缺失 → 401（fail-closed，无 LAN 放行）
SPA 拿到 401 → 跳 /login；403 → 渲 Forbidden（按能力目录显隐导航）
```

- SPA 进站 **调一次** `GET /api/auth/session` 取用户态（前端内存缓存），用于路由守卫/权限显隐；前端不读 cookie（httpOnly）、不查库。
- 根路由守卫替代原 `middleware.ts` 的粗筛（无会话→跳 login），细校验在 server。
- 能力目录 [packages/shared/permissions.ts](packages/shared/src/permissions.ts) 不动：server 端点用它做权限闸（权威），web 用它做 UI 显隐（仅体验）。

### 4.3 server 新增守卫与既有守卫的归并

- **新增 `SessionAuthGuard`**：校验会话 token（Bearer）→ `req.user`（人）+ 权限。用于**所有 web 面向的端点**（settings/sources/analysis/insights/posts/accounts/audit/...）。配 `@RequirePermission('settings:manage')` 之类做能力闸。
- **`MachineOrDeviceGuard`（sync/export）**：保留**设备签名**通道；把原 `API_TOKEN` 兜底换成 `SessionAuthGuard`（web 用户带会话也能导出）。即「设备签名 **或** 用户会话」，两条都产出 user+权限。
- **`BearerAuthGuard`（API_TOKEN）退役**：settings/sources/analysis 改挂 `SessionAuthGuard`+能力闸后，它在 HTTP 层无用。`API_TOKEN` 仅可能残留于 worker↔gateway 内部 WS（K5/O2）。

---

## 5. web 业务搬迁清单（"什么移到 server"）

探查所得，web 直连 PG 的部分全部移到 server（逻辑 1:1 搬，换 repository + 端点）：

| 域               | web 现状                                                                 | → server 端点（新）                                                                                                    | 守卫/能力                        |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 登录/会话/限流   | `lib/auth/{actions,session,throttle,audit}.ts`                           | `POST /api/auth/login`·`logout`·`change-password`，`GET /api/auth/session`·`sessions`，`DELETE /api/auth/sessions/:id` | 公开(login) / 会话               |
| 账户管理         | `lib/admin/actions.ts`（create/edit/reset/status/delete user）           | `POST/PATCH/DELETE /api/admin/users[/:id]` + 权限授予                                                                  | `accounts:manage`                |
| 设备管理         | `lib/admin/device-actions.ts`（enroll/revoke/cancel）                    | `POST /api/admin/users/:id/enrollments`、`DELETE /api/admin/devices/:id`、取消 enrollment                              | `accounts:manage`                |
| 账户/设备/审计读 | `lib/admin/{queries,device-queries}.ts`                                  | `GET /api/admin/users`·`devices`·`enrollments`·`audit`                                                                 | `accounts:manage` / `audit:view` |
| 洞察浏览         | `lib/queries.ts`：listInsights/getInsight/filterOptions                  | `GET /api/insights`·`/api/insights/:id`·`/api/insights/filters`                                                        | `insights:view`                  |
| 帖子/评论        | listPosts/getPost/getComments/listAwaitingManualResult/postFilterOptions | `GET /api/posts`·`/api/posts/:id`·`/api/posts/:id/comments`·`/api/posts/awaiting`                                      | `posts:view`                     |
| triage 读        | getTriageForInsight                                                      | 并入 `GET /api/insights/:id`（带 triage）                                                                              | `insights:view`                  |
| 统计             | getStats                                                                 | `GET /api/stats`（或并入 health 已有 stats）                                                                           | 会话                             |
| 审计写           | `lib/auth/audit.ts`（web 各处 inline 写）                                | server 各服务内写（`AuditLogsRepository`）                                                                             | —                                |

**server 需补的 repository**（`packages/db` 表都已存在，缺 DI 封装）：`UsersRepository`、`SessionsRepository`、`UserPermissionsRepository`、`LoginAttemptsRepository`、以及从 `DeviceAuthService` 抽出的 `DeviceCredentialsRepository`/`DeviceEnrollmentsRepository`/`AuditLogsRepository`。

**web 搬迁后**：删 [lib/db.ts](apps/web/src/lib/db.ts)、[lib/queries.ts](apps/web/src/lib/queries.ts)、`lib/auth/{actions,session,throttle,audit}.ts`、`lib/admin/*`；保留 `lib/auth/{cookies,current-user,guards}.ts`（改成调 server）；web 不再依赖 `@hatch-radar/db`、env 去掉 `DATABASE_URL`。页面与 server actions 改为 fetch server API。

---

## 6. 数据流改造要点（前端 = 同源 SPA）

前端已定改 Vite + React Router 同源 SPA（详见 [[frontend-spa-migration-design]]），原「Next RSC 取数 + Bearer 转发」方案作废，改为：

- **取数**：SPA 客户端 `fetch('/api/...')`（同源，浏览器自动带 httpOnly `radar_session` cookie）；无 RSC、无 `serverFetch` BFF、无 Bearer 转发。
- **mutation**：同样客户端 `fetch` server 端点；登录 `POST /api/auth/login` 由 server `Set-Cookie`。
- **既有代理路由**（settings/sources/analysis/export）**删除**——SPA 同源直连 `/api`，不再经 web 转发。
- **用户态**：进站 `GET /api/auth/session` 取一次（前端内存缓存），各数据调用各自带 cookie、server 重验。

---

## 7. 实施计划（K8 分期，每期可单独发）

### P0 — server 成为鉴权权威（**先吃掉复杂度**）

1. 补 repo：users/sessions/user_permissions/login_attempts + 抽出 device_credentials/device_enrollments/audit_logs。
2. 新 `AccountModule`：`AuthController`（login/logout/change-password/session/sessions）+ `AccountService`（搬 web 的登录/会话/限流逻辑）+ `SessionAuthGuard`。
3. 既有 web 面向端点（settings/sources/analysis）`BearerAuthGuard` → `SessionAuthGuard` + `@RequirePermission`。
4. web：login/account/改密/会话管理改调 server；`getCurrentUser`/guards 改调 `GET /api/auth/session`；删 web 的 session/throttle 直连。
5. sync/export 守卫：`API_TOKEN` 兜底 → 会话；保留设备签名。
6. **退役 HTTP 层 `API_TOKEN`**（双平面 + LAN 特判到此消失）。

### P1 — 只读业务搬迁

7. 新 `DataModule`：insights/posts/comments/stats/triage 只读端点（搬 [lib/queries.ts](apps/web/src/lib/queries.ts)）+ `insights:view`/`posts:view` 闸。
8. web 首页/insights/posts/analyze 页改 fetch server。

### P2 — 写业务搬迁 + 去 web 直连

9. 新 `AdminModule`：账户/设备/权限/审计端点（搬 `lib/admin/*`）。
10. 删 web 全部直连 PG（lib/db、queries、auth/session 等）；web env 去 `DATABASE_URL`；web 去 `@hatch-radar/db` 依赖。

### P3 — 清理与退役

11. 删 `BearerAuthGuard`、`API_TOKEN`（或仅留 worker↔gateway 内部令牌）；删 main.ts 的 LAN/NODE_ENV 特判。
12. 文档：修订 [[web-write-convention]]、[[account-rbac-design]] §3/§8/§9；README 架构图更新。

---

## 8. 风险与取舍

- **工作量集中在「搬」而非「想」**：账户/查询逻辑 web 已有、且行为不变，多是 1:1 迁到 server + 加端点；真正新写的只有 repo 封装与守卫。但端点面不小（账户/管理/只读数据十余个），是个项目级改动。
- **前端纯 CSR**：改同源 SPA 后无 SSR（[[frontend-spa-migration-design]]）——内网控制台可接受，首屏用骨架屏兜。原「SSR 双跳延迟」风险随之消失（SPA 客户端直连同源 `/api`）。
- **会话过 TLS**：会话 token 在 web→server 间传输，公网部署必须 TLS（呼应「就当普通网络」——本就该做）。
- **事务**：web 里的事务（如 editUser 改权限）整体搬进 server service，无损。
- **临时双轨**：分期期间 web 部分直连、部分走 server 并存；P2 收口前两套鉴权短暂共存（可接受，P0 后人鉴权已统一在 server，web 直连读只是数据面）。

---

## 9. 待定决策（请拍板）

> 已按推荐写入正文，可改：

1. **O1 — web→server 会话载体**：推荐 web 读自己 cookie、以 `Authorization: Bearer <sessionToken>` 转发（与 mobile 走 header 一致、不耦合 cookie 域）。备选：直接透传 `Cookie` 头。
2. **O2 — `API_TOKEN` 是否全删**：推荐 HTTP 层全退；worker↔gateway 内部 WS 视部署（同机/私网→可不要；可远程→留一个内部令牌或上 mTLS）。
3. **O3 — 用户态获取**：推荐 `GET /api/auth/session` 每请求缓存一次 + 各数据调用各自带 token（server 重验，索引查询廉价）。备选：server 在每个响应里回带用户态。
4. **O4 — 分期顺序/粒度**：推荐 P0→P1→P2→P3；其中 **P0 单独就能消除你嫌烦的双平面**，可先只做 P0 再评估后续。
5. **O5 — web 是否保留极少量直读**：推荐**零直读**（彻底单一后端）；若 SSR 延迟敏感，可破例保留个别只读查询直连——但会留尾巴，不建议。

---

## 10. 安全清单

- [x] server 单一鉴权权威：会话（人）/ 设备签名（mobile）一处校验 + 查权限；fail-closed，无 LAN 放行。
- [x] 会话 token 不透明、库存哈希、双过期可吊销（沿用现状，移到 server）。
- [x] 密码 scrypt + 限流（login_attempts）随登录搬到 server。
- [x] web 零 PG 访问、零密钥；env 去 `DATABASE_URL`；不再持任何业务凭据。
- [x] `API_TOKEN` HTTP 退役，消除「未配即放行」fail-open 与环境特判。
- [x] 会话/凭据传输走 TLS（部署层，反代/ingress）。
- [ ] 未来：CSRF（SameSite=Lax + 同源）、会话固定防护复核（搬迁时一并带过）。
