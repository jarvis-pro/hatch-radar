# hatch-radar

> 定时抓取 Reddit 目标版块的帖子与评论，通过 AI 分析提炼出结构化的用户痛点、需求信号与产品机会。

---

## 功能概览

- 通过 Reddit OAuth API 定时抓取指定版块的热门帖子与评论
- 令牌桶队列管理请求速率，严格控制在 100 次/分钟以内，自动处理 429 退避重试
- 将帖子与评论组合为结构化上下文，批量送入 AI 分析（默认导出为本地文件；配置后可用 Anthropic / DeepSeek 分析）
- 输出痛点清单、需求信号、产品机会及目标用户画像
- 结果持久化存储，支持按版块、标签、强度过滤检索

---

## 技术栈

| 层级          | 技术                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| 运行时        | Node.js + TypeScript                                                              |
| 调度          | node-cron                                                                         |
| Reddit 数据源 | Reddit REST API（OAuth）                                                          |
| AI 分析       | Anthropic（`@anthropic-ai/sdk`）/ DeepSeek（OpenAI 兼容），或导出本地文件（默认） |
| 存储          | SQLite（可替换为 PostgreSQL）                                                     |
| 包管理        | pnpm                                                                              |

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
# 开发模式
pnpm dev

# 生产模式
pnpm build && pnpm start
```

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
│   └── server/                 # 工作台后端：爬取 + AI 分析 + 调度
│       ├── src/
│       │   ├── config/
│       │   │   ├── env.ts      # 环境变量加载、校验与分析方式推导
│       │   │   ├── subreddits.ts  # 目标版块配置
│       │   │   └── feeds.ts    # HackerNews 频道与 RSS 源配置
│       │   ├── crawler/
│       │   │   ├── queue.ts    # 令牌桶请求队列
│       │   │   ├── reddit.ts   # Reddit API 封装
│       │   │   ├── hackernews.ts  # HackerNews API 封装
│       │   │   ├── rss.ts      # RSS 订阅抓取
│       │   │   └── context.ts  # 帖子+评论上下文构建
│       │   ├── analyzer/
│       │   │   ├── prompt.ts   # 分析 prompt、输出 schema 与结果归一化
│       │   │   ├── anthropic.ts   # Anthropic（Claude 模型）调用
│       │   │   ├── deepseek.ts # DeepSeek（OpenAI 兼容）调用
│       │   │   ├── export.ts   # 本地文件导出（默认方式）
│       │   │   └── analyze.ts  # 处理器抽象、工厂与批处理调度
│       │   ├── db/
│       │   │   ├── schema.ts   # SQLite 连接管理（兼作迁移脚本，DDL 来自 shared）
│       │   │   ├── posts.ts    # 帖子存取
│       │   │   ├── comments.ts # 评论存取
│       │   │   ├── insights.ts # 洞察存取
│       │   │   └── utils.ts    # 通用工具
│       │   ├── scheduler.ts    # 定时任务调度
│       │   ├── cli.ts          # 洞察检索 CLI（pnpm insights）
│       │   ├── analyze-once.ts # 手动触发一轮分析（pnpm analyze）
│       │   ├── logger.ts       # 日志工具
│       │   └── index.ts        # 入口
│       ├── data/               # SQLite 数据文件（gitignore）
│       ├── logs/               # 运行日志（gitignore）
│       └── .env.example
├── packages/
│   └── shared/                 # 跨端共享：DB DDL、行类型、洞察域类型、同步协议类型
│       └── src/
├── docs/
│   └── multiplatform-refactor-spec.md  # 多端重构需求规格
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
