# hatch-radar

> 定时抓取 Reddit 目标版块的帖子与评论，通过 AI 分析提炼出结构化的用户痛点、需求信号与产品机会。
> 三端协同：工作台后端（爬取 + AI）→ Web 只读控制台 → RN 离线伴侣 App（人工研判）。

---

## 功能概览

- **工作台后端（apps/api 控制面 + apps/worker 数据面，NestJS）**：api 定时抓取 Reddit / HackerNews / RSS（令牌桶限速）、提供 `/api` + 鉴权 + 调度 + push 网关；帖子+评论组合上下文经 PostgreSQL 持久化队列交 worker 池跑 AI 分析（Web 设置页配置 Anthropic / OpenAI / DeepSeek / Claude 订阅）；AI 密钥加密入库、只在后端进程
- **Web 控制台（apps/web）**：只读展示洞察 / 帖子 / 评论与同步回传的人工研判，筛选/搜索/分页，响应式，Docker 部署
- **导出批次**：按条件筛「有效数据」，经局域网 HTTP 接口或 `.sqlite` / `.json` 文件（AirDrop）交付给移动端
- **离线伴侣 App（apps/mobile）**：Expo + 本地 SQLite，导入批次后全程离线人工研判（状态/评级/标签/笔记），操作记入本地 outbox
- **同步回传**：回到局域网后 App 提示待同步数，用户确认推送；工作台按 opId 幂等应用（重发不重复生效）
- **内容翻译（按需）**：抓取的英文标题/正文/评论可在帖子页一键译成中文（供移动端研判）；两档 provider——Claude 订阅（零边际成本、最高质量）或 Azure Translator 机翻（按字符计费、免费额度大，走量降订阅消耗），译文按内容哈希缓存、新评论增量翻译
- **流水线检视器（逐节点调试 / 演示）**：把单条帖子的 AI 分析拆成 6 个显式节点逐步执行，可逐节点暂停查看每步产物（解析的上下文、完整 Prompt、AI 原始响应、归一化洞察），用于调参、排障与对外演示

---

## 技术栈

| 层级          | 技术                                                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行时        | NestJS + TypeScript（pnpm workspace monorepo；swc-node ESM 运行）                                                                                                                      |
| 调度          | `@nestjs/schedule`（`@Cron`）                                                                                                                                                          |
| Reddit 数据源 | Reddit REST API（OAuth）                                                                                                                                                               |
| AI 分析       | 多模型可配：Anthropic（`@anthropic-ai/sdk`）/ OpenAI / DeepSeek / Claude 订阅（`claude_cli`，复用本机 Claude Code 登录态）；PostgreSQL 任务队列（`FOR UPDATE SKIP LOCKED`）+ Worker 池 |
| 内容翻译      | 同队列（`job_type=translation`）：Claude 订阅（`claude_cli`）/ Azure Translator 机翻（`azure`）；译文按内容哈希缓存于 `translations` 表                                                |
| 存储          | PostgreSQL（Prisma ORM；**server 是唯一读写方**，web 不直连库）；导出 `.sqlite` 与移动端 expo-sqlite 互通                                                                              |
| Web 控制台    | Vite + React Router 同源 SPA（纯 CSR，经 `/api` 调 server；由 NestJS `ServeStaticModule` 同源托管 build 产物）                                                                         |
| PC 端 UI 库   | shadcn/ui + Tailwind CSS v4（`packages/ui` 共享，仅限 Web/PC 子项目）                                                                                                                  |
| 移动端        | React Native（Expo SDK 56 + expo-router + expo-sqlite）                                                                                                                                |

---

## 快速开始

### 1. 克隆与安装依赖

```bash
git clone https://github.com/your-org/hatch-radar.git
cd hatch-radar
pnpm install
```

### 2. 配置环境变量

api / worker 共享的两个必填项放在**工作区根** `.env`，两个进程启动时都会自动加载（`prisma migrate` 也用它）：

```bash
cp .env.example .env
```

编辑根 `.env`（密钥只属于后端进程，不会进入 web / mobile）：

```env
# 数据库（PostgreSQL；本地用 docker-compose 起，生产换托管 PG 只改此串）
DATABASE_URL=postgres://radar:radar@localhost:47432/hatch_radar

# 模型密钥与 Reddit 凭据的加密主密钥（设置页配置须先设它）；留空则禁用 AI 分析
SETTINGS_SECRET=                 # openssl rand -hex 32
```

> 数据来源 / Reddit 采集凭据 / AI 模型接入一律在 Web 设置页（/settings）配置入库，env 不承载任何凭据。
> 共享调优项 `LOG_LEVEL` / `HTTP_PORT` / `DATABASE_POOL_MAX` 也在根 `.env`（取消注释即覆盖两端）；各进程专属项（api 的超管种子 / `WEB_DIST_DIR`，worker 的 `GATEWAY_URL` / `WORKER_CONCURRENCY`）按需另建 `apps/api/.env`、`apps/worker/.env`，见各自 `.env.example`；不建也能用默认值启动。

### 3. 起数据库并建表

```bash
docker compose up -d db   # 本地 PostgreSQL（默认 radar/radar @ localhost:47432/hatch_radar）
pnpm db:migrate           # prisma migrate deploy 应用迁移建出全部表
```

> dev / start 脚本在进程启动前自动执行 `prisma migrate deploy`（幂等）；首次/CI 可用上面的命令显式建表。
>
> 集成测试库 `hatch_radar_test` 在 compose **首次初始化数据卷**时自动建出（见 `docker/initdb/`），测试经 `pnpm --filter @hatch-radar/api test` 直连；若曾 `docker compose down -v` 重建过卷，按需补建：`docker compose exec db createdb -U radar hatch_radar_test`。

### 4. 启动

```bash
# 控制面 api（HTTP /api + 爬取 + 调度 + push 网关 + 同源托管 SPA）
pnpm dev:api            # 开发模式（swc-node + node --watch 自动重启）
pnpm start:api          # 无 watch，直接以 TS 源跑（生产 / 容器入口）

# 数据面 worker（独立进程，可多开横向扩；经 PG 队列认领 + WS 连 api 网关跑 AI 分析）
pnpm dev:worker         # 开发模式（node --watch）
pnpm start:worker       # 无 watch（生产 / 容器入口）；需配 apps/worker/.env，单机可复用 api 的

# Web 控制台（开发期 Vite dev server，/api 代理到 api）
pnpm dev:web            # http://localhost:47080
```

---

## Web 控制台

- 展示洞察 / 帖子 / 评论：来源 / 版块 / 强度 / 分析状态筛选 + 关键词搜索 + 分页，响应式自适应手机
- **纯前端 SPA**（Vite + React Router，无 SSR）：所有数据与写操作经同源 `/api/*` 调 server；浏览器自动带 httpOnly `radar_session` cookie，写请求带 `X-Radar-Csrf` 头（CSRF 兜底）。web 不连库、不持任何密钥
- 鉴权：登录 `POST /api/auth/login` 由 server 下发 cookie；进站 `GET /api/auth/session` 取用户态做路由守卫 / 导航显隐（权威校验恒在 server）
- 「设置」页（`/settings`）管理模型（增删改、选用 active、连通性测试，密钥仅脱敏展示）；「分析」页（`/analyze`）多选帖子 + 选模型运行，并实时轮询队列进度
- dev：`pnpm dev:web`（Vite 47080）把 `/api` 代理到 server（47878）保持同源；prod：`pnpm build:web` 出 `dist/`，由 server 同源托管（单一部署物）
- UI 组件来自 `@hatch-radar/ui`（shadcn/ui）。新增组件在 `apps/web` 下执行
  `pnpm dlx shadcn@latest add <component>`，CLI 会自动把组件写入 `packages/ui`，所有 PC 子项目共用

Docker 部署有两种用法，由 compose profile 切换：

**① 轻量开发（默认）**：仅起 `db`，api / worker 跑在宿主机享原生热重载与本机 claude 登录态。

```bash
docker compose up -d db         # 仅起库（PostgreSQL）
pnpm dev:api                    # 控制面 api（node --watch 热重载）
pnpm dev:worker                 # 数据面 worker（node --watch；可多开横向扩）
pnpm dev:web                    # Web 控制台（Vite HMR，:47080）
```

**② 全栈容器化（`--profile full`）**：db + api + worker×2 + web 全进容器，一键起全套；web 由 api 同源托管，访问 `http://localhost:47878`。

```bash
docker compose --profile full up -d --build   # 起 / 重建全栈（首次或改代码后加 --build）
```

> 全栈下 worker 跑 AI 须用 API Key 模式 provider（设置页配 + 根 `.env` 填 `SETTINGS_SECRET`）；claude_cli 订阅模式依赖宿主机登录态、仅适合轻量开发。api / worker 共用一个镜像（根 `Dockerfile`，跑 TS 源），仅启动命令不同。

> api（爬取 + AI + 密钥 + 鉴权权威）按规格跑在工作台宿主机上。并发瓶颈已交给 PG 异步驱动 + 连接池：
> 定时器写库与局域网多人操作真正并行，不再串行在单条事件循环上；分析执行的水平扩在 worker 这层。

---

## 导出批次（给移动端导数据）

「有效数据」基线：洞察须有实质信号（痛点或机会非空），可叠加 `since / 强度 / 版块 / 条数` 筛选。

**局域网 HTTP**（随 `pnpm dev:api / start:api` 自动启动）：

| 端点                           | 说明                                                                 |
| ------------------------------ | -------------------------------------------------------------------- |
| `GET /api/health`              | 健康检查 + 数据概览（不鉴权，App 探测工作台用）                      |
| `GET /api/export/batch`        | JSON 批次；参数 `since / minIntensity / subreddit / limit`           |
| `GET /api/export/batch.sqlite` | 同条件的独立 `.sqlite` 文件下载                                      |
| `POST /api/sync/push`          | 接收移动端研判操作，按 `opId` 幂等应用（写 triage 表）               |
| `* /api/settings/*`            | 模型清单 CRUD + 选用 active + 连通性测试（密钥加密入库，仅脱敏外发） |
| `POST /api/analysis/run`       | 手动运行：选中帖子按指定模型入队（trigger=manual）                   |
| `GET /api/analysis/jobs`       | 分析队列看板（状态汇总 + 最近任务）                                  |

端口 `HTTP_PORT`（默认 47878），同进程既发 `/api`、又同源托管 web SPA。鉴权恒开、fail-closed（无 `API_TOKEN`、无局域网放行）：web 面向端点走会话 cookie + 能力闸（`SessionAuthGuard`），导出 / 同步走「设备签名 **或** 用户会话」双通道（`DeviceOrSessionGuard`），设备激活由一次性激活码自鉴权，`/api/health` 公开。

**文件导出**（产物可 AirDrop 给手机）：在 web 控制台首页点「导出批次」，按条件（最近天数 / 最低强度 / 版块 / 上限）筛出有效数据，下载 `.sqlite`（移动端导入）或 `.json`；SPA 同源直连 `/api/export/batch(.sqlite)`（带会话 cookie），复用 server 同一套 sqlite-writer。

---

## 移动端（离线伴侣 App）

```bash
pnpm dev:mobile   # 启动 Expo dev server，用 Expo Go 扫码（iOS 真机）
```

- 本地 SQLite 与服务器同文件格式；导入批次两种方式：
  1. **局域网拉取**：在「工作台同步」页填工作台地址（server 启动日志会打印局域网 IP）
  2. **文件导入**：选择 AirDrop / 文件 App 里的 `.sqlite` / `.json` 批次
- 导入为幂等合并，重复导入不产生重复数据；全程离线可用，App 内无 AI、无密钥
- **离线研判**：洞察详情页设置状态（待研判/已入选/已归档）、1-5 星评级、研判标签、笔记；
  列表页可按强度与研判状态筛选。每次变更先写本地表，同时记入 outbox 操作日志
- **同步回传**：首页横幅提示「有 N 条研判待同步」→ 同步页确认推送 → 工作台按 `opId`
  幂等应用并留痕（`sync_ops`），重复推送返回 duplicate 不重复生效；同步结果可在
  Web 控制台洞察详情页查看。当前方向仅 App → 工作台（规格 §D）

---

## AI 分析方式

模型在 **Web 设置页（`/settings`）** 配置：可添加多条 Anthropic / OpenAI / DeepSeek（API Key 模式）或 **Claude 订阅（`claude_cli`，复用 worker 本机已登录的 Claude Code、吃订阅额度、无需 API Key）** 模型；API Key 模式每条可挂**多把 Key 做故障转移**（限流自动冷却、鉴权失败自动切换），密钥经 `SETTINGS_SECRET`（AES-256-GCM）**加密入库**，API 仅返回脱敏视图、绝不下发明文。

| 厂商        | 结构化输出                                                                    |
| ----------- | ----------------------------------------------------------------------------- |
| Anthropic   | Claude 系列，`messages` + JSON Schema 约束                                    |
| OpenAI      | ChatGPT 系列，`response_format: json_schema`（strict）                        |
| DeepSeek    | OpenAI 兼容接口，`response_format: json_object`                               |
| Claude 订阅 | `claude_cli`：经 Claude Agent SDK 复用本机登录态，`outputFormat: json_schema` |

**自动 vs 手动**（核心状态机）：

- **选用了 active 模型** → 定时调度（每小时）+ 选用时即时入队，自动分析待处理帖子。
- **未选用 active** → 不自动分析；在「分析」页多选帖子 + 选一个模型 → 手动运行入队。
- **一条模型都没配 / 模型无可用 Key** → 先去设置页加一个模型并填至少一把 API Key（无可用 Key 不能设为启用）。

**队列驱动**：定时与手动运行都只是把帖子写入 PostgreSQL 持久化任务队列（`analysis_jobs`），由常驻 Worker 池靠 `FOR UPDATE SKIP LOCKED` 认领消费——并发认领不重不漏、可多进程/独立进程扩展（仅 Worker 这层水平扩；HTTP + 定时调度的主进程为单实例，cron 无分布式锁），单任务超时、失败重试、僵死/孤儿回收，进程重启自动续跑，单个慢调用不会卡住整批。改密钥/模型/选用即热重载，无需重启进程。洞察按 `post_id` 幂等落库（`model` 记真实模型 ID），重分析覆盖且保住研判。

> 多 Key 故障转移：单次分析按 Key 的 `priority` 选「可用」的一把；遇限流（429）冷却 5 分钟后自动重试，遇鉴权失败/额度耗尽标记失效（需在设置页复位），失败即切下一把，全部不可用才判任务失败。

---

## 流水线检视器（逐节点调试 / 演示）

把**单条**帖子的 AI 分析拆成 6 个显式节点，逐步执行、可逐节点暂停查看每步产物——用于调参、排障与对外演示。在**帖子详情页**点「流水线检视」、选模型与是否逐节点闸门即发起；**队列页**的检视任务行有「检视 →」直达。

节点流水线（每节点产物落 `job_steps` 表）：

| seq | 节点        | 产物                                           |
| --- | ----------- | ---------------------------------------------- |
| 0   | `resolve`   | 模型标签 / provider 类型 / 可用 Key 数         |
| 1   | `fetch`     | 帖子标题、正文字数、评论数与楼层               |
| 2   | `context`   | 完整 SYSTEM_PROMPT + 拼好的上下文 + token 估算 |
| 3   | `ai_call`   | AI 原始响应 + token usage + 实际用的 Key       |
| 4   | `normalize` | 结构化洞察（痛点 / 机会）+ 丢弃统计            |
| 5   | `persist`   | 是否落库、洞察 id、痛点 / 机会数               |

**机制 = 检查点 + 重认领**：worker 跑完一个节点就把产物落库，逐节点闸门开启时把任务置 `paused` 后正常结束（不阻塞 worker）；点「继续」让任务回 `queued` 被重新认领、从下一节点续跑。`ai_call` 是唯一不可重算的节点（花钱、起子进程），故必须落检查点；其余节点持久化保证「所见即所跑」（防两次认领之间评论被改写）。也可「运行到底」（关闸连续跑完）、重试失败节点或取消。前端用 react-flow 画横向流程图 + 节点产物面板，轮询刷新（运行中 1.5s / 暂停 2.5s / 终态停）。

| 端点                                           | 说明                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/analysis/inspect`                   | 发起检视任务（`postId` + `providerId` + `stepGate`），建 job + 6 节点 |
| `GET  /api/analysis/inspect/:jobId`            | 取任务 + 6 节点轨迹（前端轮询）                                       |
| `POST /api/analysis/inspect/:jobId/resume`     | 放行下一节点（`paused→queued`）                                       |
| `POST /api/analysis/inspect/:jobId/run-to-end` | 关闭闸门、连续跑完剩余节点                                            |
| `POST /api/analysis/inspect/:jobId/retry-step` | 重试当前失败节点                                                      |
| `POST /api/analysis/inspect/:jobId/cancel`     | 取消检视任务                                                          |

> 设计取舍与落地偏差详见 [`docs/pipeline-inspector-design.md`](docs/pipeline-inspector-design.md)。当前 M1–M3 + 大部分 M4 已落地；待真起 AI 模型的浏览器端到端走查。

---

## 内容翻译（译中文）

抓取内容默认英文；移动端研判需要中文时，可在帖子页**按需**一键翻译标题 / 正文 / 评论。译文落 `translations` 表、**按源文本内容哈希寻址**（扛评论 churn、同文去重、未命中即「待翻译」自动判定首次/增量），随导出产物进移动端。

两档翻译 provider（在 `/settings` 配，与分析 active 解耦）：

| 档位   | provider                    | 计费                              | 定位                        |
| ------ | --------------------------- | --------------------------------- | --------------------------- |
| 高质量 | Claude 订阅（`claude_cli`） | 订阅额度（零边际成本）            | 质量优先、省钱靠订阅        |
| 走量   | Azure Translator（`azure`） | 按字符（F0 免费档 200 万字符/月） | 降订阅额度消耗、triage 速读 |

- Azure 复用与分析**同一套加密 Key 池 + `active/cooling/invalid` 故障转移**（限流冷却、鉴权失败切换）；配置项为订阅密钥 + `region`（区域代码如 `centralus`，写 `Ocp-Apim-Subscription-Region` 头），端点默认全局可覆盖。`azure` 仅用于翻译，不能设为分析 active 模型。
- 本地粗判已是中文的条目直接跳过（省成本）；远端漏译的条目留待下次补，不落「已翻」假象。
- 翻译走 PG 同一队列（`analysis_jobs.job_type=translation`），与分析并发受控（`translationConcurrency`）；新增 MT 厂商（DeepL / Google）按 `azure` 同构 drop-in。

---

## 配置数据来源

在 Web 设置页（`/settings`）的「数据来源」区维护：勾选启用哪些 subreddit / HackerNews 板块 / RSS 源（一行 = 一个「爬虫计划」），改完下一轮调度即生效。首启会从代码常量（`apps/api/src/domain/seed/source-lists.ts`，仅作**首启种子**）播种一份默认列表。

Reddit 来源需先在同页「采集连接器」配置 OAuth 凭据（加密入库）并点「测试」通过，其来源的启用开关才会解锁——前端置灰、服务端校验、调度防御三道闸。

> Reddit 官方 API 有作废风险（停发免费 key、起诉爬虫）；连接器凭据以 `auth_kind` 抽象（`oauth` 现状 / `scrape` 未来代理爬虫），切换不改表。详见 `docs/runtime-config-design.md` §1.3 / §4。

---

## 项目结构

pnpm workspace monorepo。根目录脚本约定：**`dev:*` = 开发（全 `--watch` / HMR：`dev:api` / `dev:worker` / `dev:web` / `dev:mobile`），`start:*` = 生产 / 容器入口（无 watch：`start:api` / `start:worker`，Docker 跑这两个）**；`build:web` 出 SPA 产物，`test` / `typecheck` / `lint` 全仓，`db:*` 代理到 `@hatch-radar/db`。

后端按「**框架无关能力包 + 两个应用进程**」组织：领域逻辑沉到能力包（kernel/db/crawler/analysis），api（控制面，单实例）与 worker（数据面，可横扩）各自薄壳装配复用；经 PG 队列 + WS 网关解耦。

```
hatch-radar/
├── apps/
│   ├── api/                    # 控制面（NestJS，单实例）：HTTP /api + 鉴权 + 定时调度 + push 网关 + 同源托管 web SPA
│   │   ├── src/
│   │   │   ├── main.ts         # HTTP 应用入口（NestFactory）
│   │   │   ├── app.module.ts   # 根模块（HTTP + 调度 + 网关 + 种子 + 静态托管）
│   │   │   ├── domain/         # 本 app 领域层：assembly(createCore 装配) + 桶 index + account/admin/auth/data/sync/export/gateway/scheduler/seed 服务
│   │   │   ├── core/           # CoreModule：调 createCore 一处装配，按「类令牌 + useFactory」桥接进 Nest DI
│   │   │   ├── config/ database/   # env 校验(@nestjs/config) + Prisma 连接 provider（连通性自检 + 优雅关闭）
│   │   │   ├── http/           # 控制器：health / settings / analysis(含检视) / export / sync / sources / translations / me
│   │   │   ├── account/ admin/ auth/ data/  # 控制器 + 守卫（人会话 / 设备签名 / 能力闸 / 只读数据端点）
│   │   │   ├── scheduler/ gateway/ seed/    # @Cron 调度 / WS push 网关 / 启动种子 的 Nest 生命周期薄封装
│   │   │   ├── static/ common/ logger/      # 同源托管 SPA dist / DI 令牌·zod 管道·异常过滤器 / 日志
│   │   │   └── test/           # 领域 + 控制器集成测试（vitest，连本地 PG）
│   │   └── .env.example
│   ├── worker/                 # 数据面（NestJS standalone context，可横向扩 N 实例）：PG 队列认领（分析 / 翻译 / 检视）+ WS 连 api 网关跑 AI 写回
│   │   └── src/                # main + worker.module + worker.starter + assembly(createWorkerCore) + worker.service + worker-agent
│   ├── web/                    # Vite + React Router 同源 SPA（经 /api 调 api，由 api 托管 dist）
│   └── mobile/                 # Expo 离线伴侣 App（expo-sqlite，保持不变）
├── packages/                   # 框架无关能力包（api / worker 复用，不依赖任何 Web 框架）
│   ├── kernel/                 # 基座（零内部依赖）：errors / logger / utils(time,crypto) / env 校验 / 网关协议(含 Dispatcher 接口)
│   ├── db/                     # PostgreSQL 持久层：Prisma schema + 连接工厂 + PG⇄域映射 + 17 个仓储 + runtime-settings
│   ├── crawler/                # 采集层：Reddit / HN / RSS 抓取 + 令牌桶限速 + 采集连接器配置
│   ├── analysis/               # AI 分析：analyzer 引擎(prompt / 洞察 schema / 各厂商客户端 + callRaw) + 配置入队 / 检视编排 + 洞察落库 + 翻译(translator/)
│   ├── shared/                 # 跨端共享类型（零运行时依赖）：DDL、行类型、ingestion/洞察/研判/导出/同步/检视协议、权限目录
│   ├── auth/                   # 认证 crypto（Node-only）：scrypt 口令 / 会话 token / Ed25519 设备验签
│   ├── config/                 # 共享配置切片 + TypeScript 预设（tsconfig base / nest）
│   └── ui/                     # PC 端共享 UI 库：shadcn/ui + Tailwind v4（组件经 CLI 落入此包，RN 勿引）
├── docs/                       # 设计与计划文档
├── .env.example                # 根级共享配置（DATABASE_URL/SETTINGS_SECRET + LOG_LEVEL/HTTP_PORT/POOL）：api/worker/迁移共用
├── docker-compose.yml          # 默认仅 db；profile full 起全栈（api+worker×2+web），profile tools 加 adminer
├── Dockerfile                  # api / worker 共用后端镜像（跑 TS 源 + 构建 web SPA）
├── pnpm-workspace.yaml
└── package.json                # 根脚本统一代理到子包
```

---

## 调度策略

| 任务         | 频率       | 说明                                                               |
| ------------ | ---------- | ------------------------------------------------------------------ |
| 热门帖子扫描 | 每 30 分钟 | 抓取各版块 hot/new 入库，并触发新帖即时抓评论                      |
| 评论补全     | 每 30 分钟 | 新帖即时抓；活跃帖按帖龄有界 refresh，内容变更才记一笔             |
| AI 分析入队  | 每小时     | 选用 active 模型时把待分析帖子入队、由 Worker 池消费；未选用则跳过 |
| 历史归档     | 每天凌晨   | 清理 30 天前原始数据，保留洞察结果                                 |

---

## 洞察输出格式

每次分析结果以 JSON 存储，结构如下：

```json
{
  "pain_points": [
    {
      "description": "现有工具无法批量导出数据，每次只能手动操作",
      "evidence": "原帖评论片段...",
      "intensity": "HIGH"
    }
  ],
  "opportunities": [
    {
      "title": "批量数据导出工具",
      "description": "支持一键导出、格式自定义，面向中小团队",
      "target_user": "使用 SaaS 工具的中小企业运营人员"
    }
  ],
  "tags": ["效率工具", "数据导出", "SaaS"]
}
```

强度分级：`HIGH` / `MEDIUM` / `LOW`，依据评论数量、点赞数与情绪强烈程度综合判断。

---

## 检索洞察

洞察在 web 控制台首页（`pnpm dev:web`）浏览：按来源 / 版块 / 强度筛选 + 关键词搜索，点卡片进详情看痛点与机会；需要离线分析或二次处理时，用首页「导出批次」导出 `.sqlite` / `.json`（见上文「文件导出」）。

---

## 注意事项

- 本项目仅供内部市场研究使用，**禁止将抓取数据对外分发或用于训练商业 AI 模型**，请遵守 [Reddit API 使用条款](https://www.redditinc.com/policies/data-api-terms)
- 免费 API 配额为 100 次/分钟，队列已内置限速，请勿绕过
- `User-Agent` 必须真实填写，伪造或留空可能导致账号封禁

---

## License

MIT
