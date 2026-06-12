# hatch-radar

> 定时抓取 Reddit 目标版块的帖子与评论，通过 AI 分析提炼出结构化的用户痛点、需求信号与产品机会。
> 三端协同：工作台后端（爬取 + AI）→ Web 只读控制台 → RN 离线伴侣 App（人工研判）。

---

## 功能概览

- **工作台后端（apps/server）**：定时抓取 Reddit / HackerNews / RSS，令牌桶限速；帖子+评论组合上下文批量送 AI 分析（默认导出本地文件，可配 Anthropic / DeepSeek）；AI 密钥只在此进程
- **Web 控制台（apps/web）**：只读展示洞察 / 帖子 / 评论，筛选/搜索/分页，响应式，Docker 部署
- **导出批次**：按条件筛「有效数据」，经局域网 HTTP 接口或 `.sqlite` / `.json` 文件（AirDrop）交付给移动端
- **离线伴侣 App（apps/mobile）**：Expo + 本地 SQLite，导入批次后全程离线浏览（人工研判 UI 与回传同步在后续里程碑）

---

## 技术栈

| 层级          | 技术                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| 运行时        | Node.js + TypeScript（pnpm workspace monorepo）                                   |
| 调度          | node-cron                                                                         |
| Reddit 数据源 | Reddit REST API（OAuth）                                                          |
| AI 分析       | Anthropic（`@anthropic-ai/sdk`）/ DeepSeek（OpenAI 兼容），或导出本地文件（默认） |
| 存储          | SQLite（WAL；server / web 用 better-sqlite3，移动端 expo-sqlite，文件格式互通）   |
| Web 控制台    | Next.js（App Router，standalone 产物 + Docker）                                   |
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

# AI 分析：默认导出本地文件；要用模型须设 AI_PROVIDER 并填对应 key
# AI_PROVIDER=anthropic        # 或 deepseek / file（默认 file）
# ANTHROPIC_API_KEY=your_anthropic_api_key
# DEEPSEEK_API_KEY=your_deepseek_api_key

# 数据库
DATABASE_URL=./data/radar.db
```

分析方式选择（`AI_PROVIDER`）、模型、DeepSeek 接口、导出目录、每轮分析上限等可选配置见 `.env.example` 注释。

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

**局域网 HTTP**（随 `pnpm dev / start` 自动启动；只想开导出服务用 `pnpm serve`）：

| 端点                        | 说明                                            |
| --------------------------- | ----------------------------------------------- |
| `GET /api/health`           | 健康检查 + 数据概览（不鉴权，App 探测工作台用） |
| `GET /api/export/batch`     | JSON 批次；参数 `since / minIntensity / subreddit / limit` |
| `GET /api/export/batch.sqlite` | 同条件的独立 `.sqlite` 文件下载              |

端口 `HTTP_PORT`（默认 8787），设 `EXPORT_TOKEN` 后导出接口要求 `Authorization: Bearer <token>`。

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
  1. **局域网拉取**：在 App「导入批次」页填工作台地址（server 启动日志会打印局域网 IP）
  2. **文件导入**：选择 AirDrop / 文件 App 里的 `.sqlite` / `.json` 批次
- 导入为幂等合并，重复导入不产生重复数据；全程离线可用，App 内无 AI、无密钥
- 离线研判 UI（标签/评级/笔记）与「确认后回传工作台」按规格里程碑 5/6 推进

---

## AI 分析方式

由 `AI_PROVIDER` 显式选择，默认 `file`：

| AI_PROVIDER    | 启用条件                 | 说明                                                              |
| -------------- | ------------------------ | ----------------------------------------------------------------- |
| `file`（默认） | 无需 key                 | 每篇帖子导出为自包含 `.md`，整篇粘贴给任意 AI 即可得到分析结果    |
| `anthropic`    | 须填 `ANTHROPIC_API_KEY` | 调用 Anthropic（Claude 系列模型），结构化输出（JSON Schema 约束） |
| `deepseek`     | 须填 `DEEPSEEK_API_KEY`  | 调用 DeepSeek（OpenAI 兼容接口），JSON 输出模式                   |

- 不设 `AI_PROVIDER` 时默认 `file`，无需任何 key 即可运行。
- 要用模型分析，须显式设 `AI_PROVIDER=anthropic` 或 `deepseek`，并填写对应的 API Key（缺 key 会在启动校验时报错）。
- `file` 模式导出目录默认 `./data/manual-analysis`（可由 `MANUAL_ANALYSIS_DIR` 覆盖）；导出文件含分析指令、期望的 JSON 输出格式与帖子+评论上下文。

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
│   │   │   ├── analyzer/       # prompt、Anthropic / DeepSeek 调用、文件导出、批处理
│   │   │   ├── db/             # SQLite 连接管理与各表存取（DDL 来自 shared）
│   │   │   ├── export/batch.ts # 导出批次：筛选有效数据 → JSON / .sqlite
│   │   │   ├── server/http.ts  # 局域网导出 HTTP 服务（health / batch / batch.sqlite）
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
│       ├── app/                # expo-router：洞察列表 / 详情 / 导入批次
│       └── src/                # 本地库（共享 DDL + triage/outbox/meta）、导入合并、工作台客户端
├── packages/
│   └── shared/                 # 跨端共享：DB DDL、行类型、洞察域类型、导出批次与同步协议
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
| 热门帖子扫描 | 每 30 分钟     | 抓取各版块 hot/new，写入待分析队列                  |
| 评论补全     | 发帖后 6h、12h | 对新帖回捞评论，评论越多信号越强                    |
| AI 批量分析  | 每小时         | 取未分析帖子送 Anthropic / DeepSeek，或导出本地文件 |
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
