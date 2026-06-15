# 前端迁移：Next.js → Vite + React Router（同源 SPA）

> 后端归一后 web 退成纯前端（[[backend-consolidation-design]]），Next.js 的 full-stack 那半边就闲置了。
> 据用户拍板：**弃用 Next.js，改用 Vite + React Router 的客户端 SPA**，由 NestJS **同源**托管静态产物 + `/api`。
> 同源让 httpOnly cookie 自动随请求发往 `/api`——**连 BFF / Bearer 转发都省了，server 端到端持有会话 cookie**。
> 本文是落地前的设计方案。

- **状态**：设计待评审（未实现）
- **日期**：2026-06-15
- **范围**：`apps/web`（Next App Router → Vite SPA + React Router）、`packages/ui`（去 `next-themes`，换 Vite 主题 provider）、`apps/server`（新增 `ServeStaticModule` 托管 SPA + 会话改 Set-Cookie/读 cookie）
- **前置/配套**：本文与 [[backend-consolidation-design]] 配套，并**简化**其鉴权决策（见 §6）；server 单一后端是前提
- **明确取舍**：React Router 用**库/数据模式（client SPA，`createBrowserRouter`）**，**不**用 RR v7 的 framework/SSR 模式（那会把 Node SSR 层又请回来，与「去 Next 复杂度」初衷相悖）

---

## 1. 为什么现在能弃 Next

- web 退纯前端后，Next 的卖点（RSC / server actions / 直写 PG）整块不用了，剩下的 SSR + cookie-BFF 角色，**同源 SPA 能更轻地替代**。
- **同源是关键**：NestJS 既发 SPA 又发 `/api`（同协议同域同口），浏览器对 `/api` 的 `fetch` 会**自动带上 httpOnly `radar_session` cookie**——不需要 BFF 读 cookie 再转发，也不需要把 token 暴露给 JS。会话安全模型反而更干净：**server 端到端持有 cookie**（登录 `Set-Cookie`、每次请求读 cookie 校验）。
- 收一个**单一部署物**：一个 NestJS 进程发静态 + API，去掉 Node SSR 层。
- 探查证实迁移可控：`@hatch-radar/ui` 的 shadcn 组件**几乎全部框架无关**（Tailwind + Radix），唯一耦合是 3 个文件用 `next-themes`。

---

## 2. 目标形态

```
浏览器 ──▶ NestJS（同源）
            ├─ GET /            → 发 Vite 构建的 SPA 静态产物（index.html + assets）
            ├─ GET /assets/*    → 静态资源
            ├─ /api/*           → 业务 + 鉴权（SessionAuthGuard 读 httpOnly cookie）
            └─ SPA fallback     → 未匹配的非 /api 路径回 index.html（交给 React Router 客户端路由）
```

- 前端：Vite 构建的纯客户端 React SPA，`react-router-dom` 的 `createBrowserRouter` 管路由；数据用 RR `loader` 或 React Query 客户端 fetch `/api`。
- 会话：登录 `POST /api/auth/login` → server 回 `Set-Cookie: radar_session=…; HttpOnly; SameSite=Lax`；之后同源 fetch 自动带；server `SessionAuthGuard` 读 cookie 校验。SPA **永不接触 token**。
- 托管：`@nestjs/serve-static` 指向 SPA `dist`，`exclude: ['/api/{*path}']`，非 `/api` 未命中回 `index.html`（支持前端深链刷新）。

---

## 3. 核心决策摘要

| #   | 决策     | 取值                                                                                                                                             |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | 路由库   | React Router **客户端模式**（`createBrowserRouter`），Vite 构建，无 SSR                                                                          |
| F2  | 会话载体 | **同源 httpOnly cookie 自动带**；server 端到端持 cookie（Set-Cookie + 读校验）；**取消** [[backend-consolidation-design]] 的 Bearer 转发(K3)/BFF |
| F3  | 托管     | NestJS `ServeStaticModule` 发 SPA + SPA fallback；`/api` 同源                                                                                    |
| F4  | dev 模式 | Vite dev server（HMR）+ `server.proxy` 把 `/api` 代理到 NestJS（`http://localhost:47878`），保持同源体验                                         |
| F5  | 主题     | `packages/ui` 去 `next-themes`，换 Vite 友好的小 `ThemeProvider`（html class + localStorage + prefers-color-scheme，shadcn Vite 官方做法）       |
| F6  | UI 复用  | `@hatch-radar/ui` 除主题 3 文件外**原样保留**；业务组件 JSX 基本照搬，只换路由/导航原语                                                          |
| F7  | 落地节奏 | 独立 workstream F0–F3，可与后端归一并行；F3 完成才删 Next                                                                                        |

---

## 4. 什么留、什么换

### 4.1 原样保留（大头）

- **`@hatch-radar/ui` 的全部 shadcn 基础组件**（button/card/table/dialog/select/switch/badge/tabs/...）——框架无关，零改动。
- 业务组件的 JSX 结构与 Tailwind className：[settings-manager](apps/web/src/components/settings-manager.tsx)、[sources-manager](apps/web/src/components/sources-manager.tsx)、insight-card、filter-bar 等——逻辑照搬，只换下面几样原语。
- 能力目录 [packages/shared/permissions.ts](packages/shared/src/permissions.ts)：UI 显隐继续用它。

### 4.2 逐项替换（机械、量可控）

| Next 用法                                                         | 计数 | 换成                                                                    |
| ----------------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| App Router（12 page.tsx + 1 layout）                              | 13   | RR route 组件 + layout route（`createBrowserRouter`）                   |
| `next/link`                                                       | 11   | `react-router-dom` 的 `<Link>`                                          |
| `next/navigation`（useRouter/usePathname/useSearchParams）        | 11   | RR `useNavigate` / `useLocation` / `useSearchParams`                    |
| `next/image`                                                      | 1    | 原生 `<img>`                                                            |
| `middleware.ts`（cookie 粗筛 + 重定向）                           | 1    | 客户端路由守卫（根 loader 查 `GET /api/auth/session`，无效跳 `/login`） |
| `app/api/*` 代理路由                                              | 6    | 删除——SPA 同源直连 `/api/*`（settings/sources/analysis/export/...）     |
| server actions / `lib/auth`、`lib/admin`、`lib/queries`、`lib/db` | —    | 删除——改 `fetch('/api/...')`（业务已在后端归一里搬到 server）           |
| `force-dynamic` / RSC / `next/headers` cookies()                  | 17/2 | 移除（无 SSR；cookie 由浏览器同源自动带，前端不读）                     |

### 4.3 唯一的共享包改动：去 `next-themes`

`packages/ui` 这 3 个文件耦合 `next-themes`：[theme-provider.tsx](packages/ui/src/components/theme-provider.tsx)、[mode-toggle.tsx](packages/ui/src/components/mode-toggle.tsx)、[sonner.tsx](packages/ui/src/components/sonner.tsx)。换成一个自带 `ThemeProvider`（`light|dark|system` 写 html class + localStorage + 监听 `prefers-color-scheme`），`useTheme()` 自给；`sonner` 的 theme 改读这个 context。约 30–50 行，drop `next-themes` 依赖。其余 UI 不动。

---

## 5. 鉴权在 SPA 里怎么走

```
登录页 → POST /api/auth/login {email,password}
         server 验密码 → 建会话 → Set-Cookie: radar_session（HttpOnly; SameSite=Lax; Secure(prod)）
之后任意页 → fetch('/api/...')（同源，浏览器自动带 cookie）
            server SessionAuthGuard：读 cookie → 校验 → 200 数据 / 401
SPA 根守卫：进站先 GET /api/auth/session → 拿用户态(角色/权限) 存内存
            401 → 跳 /login；某页缺权限 → 渲 Forbidden（按 packages/shared 目录显隐导航）
登出 → POST /api/auth/logout（server 删会话 + 过期 cookie）
```

- 前端**不持 token、不读 cookie**（httpOnly），用户态来自 `/api/auth/session`。
- **CSRF**：同源 + `SameSite=Lax` 已挡大部分；写操作再要求一个自定义头（如 `X-Requested-With`，server 校验）或双提交 token 兜底。

---

## 6. 对后端归一文档的简化（回修）

本决定让 [[backend-consolidation-design]] 几条决策**变简单**，已据此回修：

- **K3（web→server Bearer 转发）→ 取消**：同源 cookie 自动带，无需 web 读 cookie 转 Bearer、无 BFF。
- **K4（cookie 归 web 管）→ 改为 server 端到端**：登录 `Set-Cookie`、每请求读 cookie 校验都在 server。
- **§6 SSR 取数 / 双跳延迟 → 消失**：无 SSR；SPA 客户端直连同源 `/api`，`SessionAuthGuard` 读 cookie。
- **既有代理路由（settings/sources/analysis/export）→ 删**：SPA 同源直连，不再经 web 转发。

---

## 7. 落地节奏（workstream F，可与后端归一并行）

- **F0 脚手架**：apps/web 引 Vite + react-router-dom；建 `index.html`/`main.tsx`；接 `@hatch-radar/ui` + Tailwind；`packages/ui` 换主题 provider（去 next-themes）。
- **F1 路由骨架**：`createBrowserRouter` 铺 12 条路由 + layout route + 根守卫；site-nav/user-menu 换 RR 原语。
- **F2 逐页接 server API**：每页从「RSC 直查」改「loader/React Query fetch `/api`」；登录/账户/管理/设置/数据页逐个接上后端归一的端点；删 web 的 lib/db、queries、auth、admin、代理路由。
- **F3 托管与退役**：NestJS 上 `ServeStaticModule` 发 `dist` + SPA fallback；dev 配 Vite proxy；删 Next 依赖与 `next.config`、`middleware.ts`；web `package.json` 去 next、加 vite/react-router-dom。

> 依赖关系：F2 要消费后端归一的 server 端点，故 F2 与 [[backend-consolidation-design]] 的 P1/P2 配对推进；F0/F1 可提前并行。

---

## 8. 风险与取舍

- **丢 SSR → 纯 CSR 首屏**：内网控制台可接受（无 SEO 诉求；首屏可加骨架屏）。
- **迁移期两套并存**：Next 与 Vite SPA 不宜同时跑同一 apps/web；建议在分支上整体切，F0–F3 一气做完再合并，避免半 Next 半 Vite 的中间态。
- **深链刷新**：靠 server SPA fallback 回 index.html 解决（F3）。
- **构建/产物**：CI 从 `next build` 换 `vite build`；产物路径喂给 NestJS serve-static。
- **React Router 版本**：用 v7 的 client 数据路由（`createBrowserRouter` + `loader`）即可，**勿启用 framework(SSR) 模式**。

---

## 9. 待定决策

> 已按推荐写入正文，可改：

1. **F-O1 数据获取**：RR `loader`（路由级、与导航一体）还是 React Query（缓存/失效/轮询更强，分析看板轮询用得上）。推荐：**React Query**（项目有队列轮询、状态多），RR 只管路由。
2. **F-O2 dev 同源**：Vite proxy `/api`→NestJS（推荐，开发体验好）还是 dev 也走 CORS。推荐 proxy。
3. **F-O3 是否保留 SSR 诉求**：默认放弃。若将来要 SEO/分享预览再单独评估（与「去 Node 层」相悖，基本不会）。
