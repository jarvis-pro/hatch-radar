# hatch-radar

> 定时抓取 Reddit 目标版块的帖子与评论，通过 AI 分析提炼出结构化的用户痛点、需求信号与产品机会。

---

## 功能概览

- 通过 Reddit OAuth API 定时抓取指定版块的热门帖子与评论
- 令牌桶队列管理请求速率，严格控制在 100 次/分钟以内，自动处理 429 退避重试
- 将帖子与评论组合为结构化上下文，批量送入 AI 分析
- 输出痛点清单、需求信号、产品机会及目标用户画像
- 结果持久化存储，支持按版块、标签、强度过滤检索

---

## 技术栈

| 层级          | 技术                                        |
| ------------- | ------------------------------------------- |
| 运行时        | Node.js + TypeScript                        |
| 调度          | node-cron                                   |
| Reddit 数据源 | Reddit REST API（OAuth）                    |
| AI 分析       | Anthropic Claude API（`@anthropic-ai/sdk`） |
| 存储          | SQLite（可替换为 PostgreSQL）               |
| 包管理        | pnpm                                        |

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
cp .env.example .env
```

编辑 `.env`：

```env
# Reddit OAuth（在 https://www.reddit.com/prefs/apps 注册 script 类型应用）
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password
REDDIT_USER_AGENT=your-app-name/1.0 (by /u/your_reddit_username)

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key

# 数据库
DATABASE_URL=./data/radar.db
```

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

## 配置目标版块

编辑 `src/config/subreddits.ts`：

```typescript
export const SUBREDDITS = [
  // 通用创业 / 产品
  "entrepreneur",
  "startups",
  "indiehackers",
  "SaaS",

  // 需求直接表达
  "SomebodyMakeThis",
  "AppIdeas",

  // 按需补充垂直领域
  // "marketing",
  // "ecommerce",
];
```

---

## 项目结构

```
hatch-radar/
├── src/
│   ├── config/
│   │   └── subreddits.ts       # 目标版块配置
│   ├── crawler/
│   │   ├── queue.ts            # 令牌桶请求队列
│   │   ├── reddit.ts           # Reddit API 封装
│   │   └── context.ts          # 帖子+评论上下文构建
│   ├── analyzer/
│   │   ├── prompt.ts           # AI 分析 prompt
│   │   └── analyze.ts          # Claude API 调用
│   ├── db/
│   │   ├── schema.ts           # 数据库 schema
│   │   └── queries.ts          # 存取操作
│   ├── scheduler.ts            # 定时任务调度
│   └── index.ts                # 入口
├── data/                       # SQLite 数据文件（gitignore）
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 调度策略

| 任务         | 频率           | 说明                               |
| ------------ | -------------- | ---------------------------------- |
| 热门帖子扫描 | 每 30 分钟     | 抓取各版块 hot/new，写入待分析队列 |
| 评论补全     | 发帖后 6h、12h | 对新帖回捞评论，评论越多信号越强   |
| AI 批量分析  | 每小时         | 取未分析帖子批量送 Claude          |
| 历史归档     | 每天凌晨       | 清理 30 天前原始数据，保留洞察结果 |

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

## 注意事项

- 本项目仅供内部市场研究使用，**禁止将抓取数据对外分发或用于训练商业 AI 模型**，请遵守 [Reddit API 使用条款](https://www.redditinc.com/policies/data-api-terms)
- 免费 API 配额为 100 次/分钟，队列已内置限速，请勿绕过
- `User-Agent` 必须真实填写，伪造或留空可能导致账号封禁

---

## License

MIT
