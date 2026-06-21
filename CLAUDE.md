# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目本质

定时抓取 Reddit / HackerNews / RSS → AI 提炼用户痛点与产品机会 → 三端协同（工作台后端 + Web 控制台 + RN 离线伴侣 App）。pnpm workspace monorepo，Node ≥20 / pnpm ≥10。详见 [README.md](README.md)。

## 常用命令

> root 脚本约定：**`dev:*` = 开发（全 `--watch` / HMR：`dev:api`/`dev:web`/`dev:mobile`），`start:*` = 生产 / 容器入口（无 watch：`start:api`，Docker 跑它）**；`test`/`typecheck`/`lint` 全仓，`db:*` 代理到 `@hatch-radar/api`（Prisma 基建已并入 api）。

后端 / 全量：

- `pnpm dev:api` / `pnpm start:api` —— 起 api（单进程后端，含内嵌任务执行；启动前自动 `prisma migrate deploy`）。`dev:api` 带 `node --watch` 自动重启，`start:api` 无 watch（生产 / 容器入口）。
- `pnpm typecheck` —— 全仓 `tsc --noEmit`（= `pnpm -r typecheck`）。改完代码必跑。
- `pnpm lint` / `pnpm lint:fix` —— `eslint .`。
- `pnpm test` —— api 测试（`vitest run`，**需先 `docker compose up -d db`**，连 `hatch_radar_test`）。
  - 单测试文件：`pnpm --filter @hatch-radar/api test <文件名片段>`
  - 按用例名：`pnpm --filter @hatch-radar/api test -- -t "<name>"`
  - watch：`pnpm --filter @hatch-radar/api test:watch`

Web / Mobile：

- `pnpm dev:web`（Vite，:47080，`/api` 代理到 api:47878）/ `pnpm build:web`（出 `dist/`，由 api 同源托管）。
- `pnpm dev:mobile`（Expo dev server）。

数据库（Prisma 7）：

- `pnpm db:migrate` —— `prisma migrate deploy`（应用迁移）。
- 改 schema 后建迁移：`pnpm --filter @hatch-radar/api db:migrate:dev --name <desc>`（顺带 generate）。
- `pnpm db:generate` 重新生成 client；`pnpm db:studio`。
- 本地库：`docker compose up -d db`（PG @ `localhost:47432`，radar/radar，库 `hatch_radar`(+`_test`)）；`docker compose --profile full up -d --build` 起全栈（api+web）。

## 架构（big picture）

**单进程后端**（已退役独立 worker 进程 + WS 网关，见 `docs/single-process-consolidation-design.md`）：

- `apps/api` —— **唯一进程**。NestJS HTTP（`/api`）+ 鉴权权威 + `@Cron` 定时调度 + **内嵌任务执行**（`src/domain/worker/`：`WorkerService` 逐环节执行 + `CollectionExecutor` 采集 + `RequestGate` 出站闸）+ `ServeStaticModule` 同源托管 web SPA + 启动种子。
- **执行解耦靠 PostgreSQL 持久化队列**（`tasks` / `task_stages`）：`PipelineService` 入队后经 `LocalDispatcher`（`Dispatcher` 接口的进程内实现，替换原 WS 版 `GatewayService`）在**同进程内** `FOR UPDATE SKIP LOCKED` 认领 task（分析 / 采集 / 复查 / 翻译 / 逐节点检视）、直接调 `WorkerService` 跑 AI 写回（无 WS、无序列化）。
- **崩溃续跑 / 逐环节检查点 / 闸门 + 重认领 / 僵死回收 / 出站请求闸 / 多 Key 故障转移全原样保留**——它们与「几个进程」无关，只与「任务可靠执行」有关。并发上限 `WORKER_CONCURRENCY`（env，默认 20）由 `LocalDispatcher` 进程内闸把关（`inFlight < concurrency` + `pumping` 单飞泵防超发）。

**内联能力代码**（`apps/api/src/lib/*`，方案A 塌缩后从原 `packages/*` 并入 api；全部 `@Injectable`，见 `docs/package-architecture-eval.md`）：

- `lib/kernel` —— 基座（零内部依赖）：errors / logger / utils（time、**crypto = AES-256-GCM 密钥加解密**）/ env 校验 / 派发契约（`Dispatcher` 接口）。
- `lib/db` —— **唯一 PG 读写层**：连接工厂 + PG⇄域类型映射（`mappers.ts`）+ 仓储 + runtime-settings；Prisma schema/migrations 基建在 `apps/api/prisma/`，生成 client 在 `lib/db/generated/prisma`。
- `lib/crawler` —— 采集：Reddit/HN/RSS 抓取 + 令牌桶限速 + 采集连接器。
- `lib/analysis` —— AI：analyzer 引擎（prompt / 洞察 schema / 各厂商客户端）+ 配置入队 + 洞察落库 + **翻译**（`translator/`）。
- `lib/auth` —— Node-only 纯函数：scrypt 口令 / 会话 token / Ed25519 设备验签。

**剩余跨端包**（`packages/*`，因有 web/mobile 等非-api 消费方而保留）：`shared`（跨端类型 + 权限目录，零运行时）/ `config`（仅 tsconfig base/nest 预设）/ `ui`（shadcn + Tailwind v4，仅 PC 端）。

**DI**：`CoreModule` 把 49 个领域类（仓储 / 内联能力服务 / 领域服务 / 执行器 / 种子，全 `@Injectable`）直接列为 provider，Nest 按构造参数类型**自动注入**（已退役 `createCore` 装配桥）。非类依赖经令牌：仓储/部分服务 `@Inject(PRISMA)`、SuperAdminSeeder `@Inject(APP_ENV)`、LocalDispatcher `@Inject(WORKER_CONCURRENCY)`、PipelineService `@Inject(LocalDispatcher)`（接口参数给运行时令牌）；带默认 options 的 `TokenBucketQueue` / `RequestGate` 走 `useFactory`。生命周期由 `WorkerStarter`（`src/worker/`）薄封装（起认领泵 / 僵死回收，关停排空在途任务）。

**数据流**：crawler 抓帖+评论入 PG → 选用 active 模型时 cron 入队分析 task → `LocalDispatcher` 同进程认领、`WorkerService` 跑 AI → 洞察按 `post_id` 幂等落库 → web 只读展示 / 导出批次（`.sqlite` / `.json`）→ mobile 离线研判 → `/api/sync/push` 按 opId 幂等回传。

**三端鉴权（一套全局账户）**：web 用 httpOnly `radar_session` cookie + 写请求 `X-Radar-Csrf` 头（`SessionAuthGuard` + 能力闸）；mobile 用 Ed25519 设备凭据（`DeviceOrSessionGuard`）；权威校验恒在 api。web 是**纯前端**，零 PG 访问、不持密钥。

## 关键约定与坑（多文件才看得出，务必遵守）

**Prisma 7**

- schema 不写 datasource url → `apps/api/prisma.config.ts`（加载根 `.env`）；运行期由 `@prisma/adapter-pg` 直供连接。schema/migrations 在 `apps/api/prisma/`。
- 生成的 client 在 `apps/api/src/lib/db/generated/prisma`（自定义 output，**导入带 `.ts` 扩展**，api tsconfig 开 `allowImportingTsExtensions`）；bigint↔number 经 `mappers.ts` 的 `toXxxRow`（仓储读出后转域类型）。
- **改 schema 后必须 `db:migrate:dev` + 重启 api 进程**：api 把生成的 client 载入内存，不重启会用旧枚举/旧字段（典型报错 `Value 'xxx' not found in enum 'yyy'`）。
- `db push` 有 AI 同意闸；迁移一律走 CLI。

**NestJS DI**：DI 注入的值（服务 / 仓储）**不要用 `import type` 导入**——会在 boot 时炸而 `tsc` 不报。

**导入别名**：跨目录用 `@/`（= 各 app 的 `src`），同目录用 `./`；由 `eslint.config.js` 内联规则强制（现成插件在 ESLint 10 崩故自写）。`@/` 在 tsc / vitest / swc(oxc-resolver) 三处各自解析。

**运行期配置**：可种子化配置一律「**代码常量仅作首启种子 → DB → 设置页扩展**」，勿在代码里维护运行期配置。种子在 `apps/api/src/domain/seed`（Seeder + SeedRunner）。数据来源 / Reddit 凭据 / AI 模型 / 翻译 provider 全在 `/settings` 配置入库，**env 不承载任何凭据**。

**密钥**：模型 / 连接器密钥经 `SETTINGS_SECRET`（AES-256-GCM，`kernel` 的 `crypto.ts`）加密入库，API 只返回脱敏值；未配 `SETTINGS_SECRET` 则禁用相关功能。

**AI provider + 多 Key 故障转移**：4 种 `provider_kind`——`anthropic`/`openai`/`deepseek`（API Key 模式）+ `claude_cli`（订阅模式，经 `@anthropic-ai/claude-agent-sdk` 复用后端本机已登录的 Claude Code、无 Key；单进程后已无独立 worker，订阅模式仅适合宿主机运行、容器内不可用）。API Key 模式每条挂多把 Key，状态机 `active/cooling/invalid`（429 冷却 5min、401/403 失效需人工复位）；分析与翻译共用 `apps/api/src/lib/analysis/key-failover.ts`。

**翻译**：`claude_cli`（高质量、零边际）/ `azure`（Azure Translator 机翻、按字符、走 Key 池故障转移；`region` 填区域代码如 `centralus`）。译文按源内容哈希存 `translations` 表；走分析同一队列（`analysis_jobs.job_type=translation`）。`azure` 仅翻译——`setActive` 拒之、分析路径 `providerConfigWithKey` 抛错。

**流水线检视器（单条手动 / 逐节点暂停）**：把一条帖子的分析拆成 6 个显式节点（`resolve → fetch → context → ai_call → normalize → persist`）逐步执行，每节点产物落 `job_steps` 表（`job_status` 加 `paused`、`analysis_jobs` 加 `inspect`/`step_gate`）。核心是**检查点 + 重认领**：执行器跑完一节点即落库，`step_gate` 开则置 `paused` 后正常结束（不阻塞、不占执行器），「继续」把 job 置 `queued` 重新认领、从下一节点续跑——「等待」交给持久层、执行器始终无状态。`ai_call` 是唯一不可重算的节点（花钱 / 不确定 / 起子进程）故必须落检查点，其余节点持久化是为「所见即所跑」（防两次认领间评论改写致上下文漂移）。坑：① 部分唯一索引 `uniq_jobs_active_post` 谓词已扩为 `IN (queued,running,paused)`（paused 仍占该帖活跃名额）；② `resumeInspectJob` 把 `attempts` 归零，免逐节点重认领累加误触僵死回收；③ 三 provider 的 `analyze()` 重构为 `callRaw + normalizeRawOutput`，normal 与检视共用归一化入口；④ 执行器（`apps/api/src/domain/worker/`）依赖 `@hatch-radar/shared`（节点产物契约 `packages/shared/src/inspect.ts`）。编排集中在 `AnalysisConfigService`，HTTP 端点 `/api/analysis/inspect/*` 很薄。设计稿 `docs/pipeline-inspector-design.md`。

**Claude Agent SDK 不可 mock**：`vi.mock` 拦不住 `@anthropic-ai/claude-agent-sdk`（会真起 claude）→ 把消息分发抽成纯函数（`insightFromMessage` / `translationFromMessage`）单测，勿测真实调用。

**依赖版本**：跨包共享版本集中在 `pnpm-workspace.yaml` 的 catalog，各 `package.json` 用 `"catalog:"` 引用；`react` / `react-dom` / `tailwindcss` 与 Expo 钉版的依赖故意留 inline。

**Web UI**：基于 `@hatch-radar/ui`（shadcn）+ 主题令牌，**不写自定义 CSS**、移动端响应式。加组件在 `apps/web` 下 `pnpm dlx shadcn@latest add <c>`（CLI 自动落入 `packages/ui`，PC 端共用；RN 勿引）。

**Mobile UI**：React Native Reusables（NativeWind v4）；颜色只在 `global.css` 变量、全部样式走 Tailwind `className`、**零 StyleSheet**。Expo CNG——改原生经 config plugin，勿直接改生成的 native 工程。

**env 布局**：两端都读的（`DATABASE_URL` / `SETTINGS_SECRET` + 可选 `LOG_LEVEL` / `HTTP_PORT` / `DATABASE_POOL_MAX`）在根 `.env`；各 app start 脚本叠加 `--env-file` 根 + 本地（app 覆盖根）。空串 `KEY=` 视为未设。

## 测试

`vitest`，连本地 PG（`hatch_radar_test`，compose 首次初始化数据卷时自动建于 `docker/initdb/`）。api 集成测试会跑真实 Nest 上下文 + 仓储直连 PG，故跑测试前确保 `docker compose up -d db`。
