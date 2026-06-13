# hatch-radar

> 定时抓取 Reddit 目标版块的帖子与评论，通过 AI 分析提炼出结构化的用户痛点、需求信号与产品机会。
> 三端协同：工作台后端（爬取 + AI）→ Web 只读控制台 → RN 离线伴侣 App（人工研判）。

---

## 功能概览

- **工作台后端（apps/server）**：定时抓取 Reddit / HackerNews / RSS，令牌桶限速；帖子+评论组合上下文送 AI 分析（在 Web 设置页配置 Anthropic / OpenAI / DeepSeek，SQLite 持久化队列 + Worker 池驱动）；AI 密钥加密入库、只在此进程
- **Web 控制台（apps/web）**：只读展示洞察 / 帖子 / 评论与同步回传的人工研判，筛选/搜索/分页，响应式，Docker 部署
- **导出批次**：按条件筛「有效数据」，经局域网 HTTP 接口或 `.sqlite` / `.json` 文件（AirDrop）交付给移动端
- **离线伴侣 App（apps/mobile）**：Expo + 本地 SQLite，导入批次后全程离线人工研判（状态/评级/标签/笔记），操作记入本地 outbox
- **同步回传**：回到局域网后 App 提示待同步数，用户确认推送；工作台按 opId 幂等应用（重发不重复生效）

---

## 技术栈

| 层级          | 技术                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| 运行时        | Node.js + TypeScript（pnpm workspace monorepo）                                   |
| 调度          | node-cron                                                                         |
| Reddit 数据源 | Reddit REST API（OAuth）                                                          |
| AI 分析       | 多模型可配：Anthropic（`@anthropic-ai/sdk`）/ OpenAI / DeepSeek；SQLite 任务队列 + Worker 池 |
| 存储          | SQLite（WAL；server / web 用 better-sqlite3，移动端 expo-sqlite，文件格式互通）   |
| Web 控制台    | Next.js（App Router，standalone 产物 + Docker）                                   |
| PC 端 UI 库   | shadcn/ui + Tailwind CSS v4（`packages/ui` 共享，仅限 Web/PC 子项目）             |
| 移动端        | React Native（Expo SDK 56 + expo-router + expo-sqlite）                           |

---

## 快速开始

### 1. 克隆与安装依赖

```bash
git clone https://github.com/your-org/hatch-radar.git
cd hatch-radar
pnpm install
```

### 2. 配置环境变量

```bash
cp apps/server/.env.example apps/server/.env
```

编辑 `apps/server/.env`（密钥只属于 server，不会进入 web / mobile）：

```env
# Reddit OAuth（在 https://www.reddit.com/prefs/apps 注册 script 类型应用）
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password
REDDIT_USER_AGENT=your-app-name/1.0 (by /u/your_reddit_username)

# AI 分析：推荐在 Web 设置页（/settings）配置模型（多模型、密钥加密入库）。
# 模型密钥加密主密钥（设置页配置模型必需）：
# SETTINGS_SECRET=                 # openssl rand -hex 32
# 也可用 env 作启动兜底（设了会在启动时迁移入库并设为 active）：
# AI_PROVIDER=anthropic            # 或 openai / deepseek
# ANTHROPIC_API_KEY=your_anthropic_api_key
# OPENAI_API_KEY=your_openai_api_key
# DEEPSEEK_API_KEY=your_deepseek_api_key

# 数据库
DATABASE_URL=./data/radar.db
```

模型默认 ID、各厂商接口地址、`SETTINGS_SECRET`、每轮分析上限等见 `.env.example` 注释；模型推荐在 Web 设置页配置。

### 3. 初始化数据库

```bash
pnpm db:migrate
```

### 4. 启动

```bash
# 工作台后端（爬取 + AI 分析 + 局域网导出服务）
pnpm dev                # 开发模式
pnpm build && pnpm start  # 生产模式

# Web 控制台（只读，默认读 apps/server/data/radar.db）
pnpm dev:web            # http://localhost:3000
```

---

## Web 控制台

- 只读展示洞察 / 帖子 / 评论：来源 / 版块 / 强度 / 分析状态筛选 + 关键词搜索 + 分页，响应式自适应手机
- better-sqlite3 只在服务端（Server Components），绝不进客户端 bundle；写操作统一走 server 进程
- 数据文件路径由 `DATABASE_URL` 指定，默认 `../server/data/radar.db`
- 「设置」页（`/settings`）管理模型（增删改、选用 active、连通性测试，密钥仅脱敏展示）；「分析」页（`/analyze`）多选帖子 + 选模型运行，并实时轮询队列进度。写操作经 web 代理转发到 server 进程（`SERVER_API_URL`，默认 `http://localhost:8787`），server 设了 `API_TOKEN` 时 web 也需配同值——web 自身仍只读库
- UI 组件来自 `@hatch-radar/ui`（shadcn/ui，见 `/ui-lab` 预览页）。新增组件在 `apps/web` 下执行
  `pnpm dlx shadcn@latest add <component>`，CLI 会自动把组件写入 `packages/ui`，所有 PC 子项目共用

Docker 部署（镜像基于 node:20-bookworm-slim，规格要求避开 Alpine/musl）：

```bash
docker compose up -d web        # 绑定挂载 ./apps/server/data → /data
# 或手动：
docker build -f apps/web/Dockerfile -t hatch-radar-web .
docker run -p 3000:3000 -v ./apps/server/data:/data hatch-radar-web
```

> SQLite WAL 只支持本地文件系统：数据卷必须是本地卷/绑定挂载。macOS 的 Docker Desktop 经
> VirtioFS 与宿主机写进程并发访问时锁不可靠——开发期直接 `pnpm dev:web`，容器部署放 Linux 主机。

---

## 导出批次（给移动端导数据）

「有效数据」基线：洞察须有实质信号（痛点或机会非空），可叠加 `since / 强度 / 版块 / 条数` 筛选。

**局域网 HTTP**（随 `pnpm dev / start` 自动启动；只想开导出/同步服务用 `pnpm serve`）：

| 端点                           | 说明                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| `GET /api/health`              | 健康检查 + 数据概览（不鉴权，App 探测工作台用）            |
| `GET /api/export/batch`        | JSON 批次；参数 `since / minIntensity / subreddit / limit` |
| `GET /api/export/batch.sqlite` | 同条件的独立 `.sqlite` 文件下载                            |
| `POST /api/sync/push`          | 接收移动端研判操作，按 `opId` 幂等应用（写 triage 表）     |
| `* /api/settings/*`            | 模型清单 CRUD + 选用 active + 连通性测试（密钥加密入库，仅脱敏外发） |
| `POST /api/analysis/run`       | 手动运行：选中帖子按指定模型入队（trigger=manual）         |
| `GET /api/analysis/jobs`       | 分析队列看板（状态汇总 + 最近任务）                        |

端口 `HTTP_PORT`（默认 8787），设 `API_TOKEN` 后导出与同步接口要求 `Authorization: Bearer <token>`。

**文件导出**（产物可 AirDrop 给手机）：

```bash
pnpm export:batch                      # 全量有效数据 → ./data/exports/batch-<时间戳>.sqlite
pnpm export:batch -- --days 7 -i MEDIUM   # 近 7 天中高强度
pnpm export:batch -- -f json -o /tmp/b.json
```

---

## 移动端（离线伴侣 App）

```bash
pnpm mobile     # 启动 Expo dev server，用 Expo Go 扫码（iOS 真机）
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

模型在 **Web 设置页（`/settings`）** 配置：可添加多条 Anthropic / OpenAI / DeepSeek 模型，密钥经 `SETTINGS_SECRET`（AES-256-GCM）**加密入库**，API 仅返回脱敏视图、绝不下发明文。

| 厂商      | 结构化输出                                              |
| --------- | ------------------------------------------------------- |
| Anthropic | Claude 系列，`messages` + JSON Schema 约束              |
| OpenAI    | ChatGPT 系列，`response_format: json_schema`（strict）  |
| DeepSeek  | OpenAI 兼容接口，`response_format: json_object`         |

**自动 vs 手动**（核心状态机）：

- **选用了 active 模型** → 定时调度（每小时）+ 选用时即时入队，自动分析待处理帖子。
- **未选用 active** → 不自动分析；在「分析」页多选帖子 + 选一个模型 → 手动运行入队。
- **一条模型都没配** → 先去设置页加一个（无密钥无法调用模型）。

**队列驱动**：定时与手动运行都只是把帖子写入 SQLite 持久化任务队列（`analysis_jobs`），由常驻 Worker 池消费——并发、单任务超时、失败重试、僵死/孤儿回收，进程重启自动续跑，单个慢调用不会卡住整批。改密钥/模型/选用即热重载，无需重启进程。洞察按 `post_id` 幂等落库（`model` 记真实模型 ID），重分析覆盖且保住研判。

> 启动兜底：若在 `.env` 设了 `AI_PROVIDER` + 对应 KEY + `SETTINGS_SECRET`，启动时会把它一次性迁移入库并设为 active（老配置无感升级）。

---

## 配置目标版块

编辑 `apps/server/src/config/subreddits.ts`：

```typescript
export const SUBREDDITS = [
  // 通用创业 / 产品
  'entrepreneur',
  'startups',
  'indiehackers',
  'SaaS',

  // 需求直接表达
  'SomebodyMakeThis',
  'AppIdeas',

  // 按需补充垂直领域
  // "marketing",
  // "ecommerce",
];
```

---

## 项目结构

pnpm workspace monorepo（多端规划见 `docs/multiplatform-refactor-spec.md`）。根目录的 `pnpm dev / build / insights / analyze` 等脚本统一代理到对应子包，用法不变。

```
hatch-radar/
├── apps/
│   ├── server/                 # 工作台后端：爬取 + AI 分析 + 调度 + 导出
│   │   ├── src/
│   │   │   ├── config/         # env 校验、目标版块、HN/RSS 源
│   │   │   ├── crawler/        # 令牌桶队列 + Reddit / HN / RSS 抓取 + 上下文构建
│   │   │   ├── analyzer/       # prompt、Zod schema、Anthropic / OpenAI / DeepSeek 调用
│   │   │   ├── analysis-config.ts # 模型解析 + 热重载 + 手动/自动入队（DB 配置驱动）
│   │   │   ├── worker.ts       # 分析任务队列 Worker 池（超时 / 重试 / 僵死回收）
│   │   │   ├── crypto.ts       # 模型密钥 AES-256-GCM 加解密
│   │   │   ├── db/             # SQLite 连接与各表存取（含 providers / settings / jobs）
│   │   │   ├── export/batch.ts # 导出批次：筛选有效数据 → JSON / .sqlite
│   │   │   ├── server/http.ts  # 局域网 HTTP（health / 导出 / 同步 / 设置 / 分析运行）
│   │   │   ├── sync/apply.ts   # 同步操作校验与幂等应用（op_id 去重 + sync_ops 留痕）
│   │   │   ├── scheduler.ts    # 定时任务调度
│   │   │   ├── cli.ts          # 洞察检索 CLI（pnpm insights）
│   │   │   ├── analyze-once.ts # 手动触发一轮分析（pnpm analyze）
│   │   │   ├── export-batch.ts # 批次文件导出 CLI（pnpm export:batch）
│   │   │   ├── serve.ts        # 仅启动导出服务（pnpm serve）
│   │   │   └── index.ts        # 入口（调度 + 导出服务）
│   │   ├── data/               # SQLite 数据文件（gitignore）
│   │   └── .env.example
│   ├── web/                    # Next.js 只读控制台
│   │   ├── src/app/            # 洞察/帖子列表与详情（App Router，全 RSC）
│   │   ├── src/lib/            # 只读连接 + 查询 + 格式化
│   │   ├── src/components/     # 徽标/卡片/分页/评论树
│   │   └── Dockerfile          # 多阶段构建（node:20-bookworm-slim + standalone）
│   └── mobile/                 # Expo 离线伴侣 App
│       ├── app/                # expo-router：洞察列表 / 详情（含研判编辑）/ 工作台同步
│       └── src/                # 本地库（共享 DDL + outbox/meta）、研判与导入合并、同步推送
├── packages/
│   ├── shared/                 # 跨端共享：DB DDL、行类型、洞察域类型、研判结构、导出与同步协议
│   └── ui/                     # PC 端共享 UI 库：shadcn/ui + Tailwind v4（组件经 CLI 落入此包，RN 勿引）
├── docs/
│   └── multiplatform-refactor-spec.md  # 多端重构需求规格
├── docker-compose.yml          # web 控制台容器 + 本地数据卷
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json                # 根脚本统一代理到子包
```

---

## 调度策略

| 任务         | 频率           | 说明                                                |
| ------------ | -------------- | --------------------------------------------------- |
| 热门帖子扫描 | 每 30 分钟     | 抓取各版块 hot/new 入库，并触发新帖即时抓评论       |
| 评论补全     | 每 30 分钟     | 新帖即时抓；活跃帖按帖龄有界 refresh，内容变更才记一笔 |
| AI 分析入队  | 每小时         | 选用 active 模型时把待分析帖子入队、由 Worker 池消费；未选用则跳过 |
| 历史归档     | 每天凌晨       | 清理 30 天前原始数据，保留洞察结果                  |

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

```bash
# 最新洞察
pnpm insights

# 按版块 / 标签 / 强度过滤
pnpm insights --subreddit SaaS --tag 效率 --intensity HIGH

# JSON 输出，便于二次处理
pnpm insights --json
```

---

## 注意事项

- 本项目仅供内部市场研究使用，**禁止将抓取数据对外分发或用于训练商业 AI 模型**，请遵守 [Reddit API 使用条款](https://www.redditinc.com/policies/data-api-terms)
- 免费 API 配额为 100 次/分钟，队列已内置限速，请勿绕过
- `User-Agent` 必须真实填写，伪造或留空可能导致账号封禁

---

## License

MIT
