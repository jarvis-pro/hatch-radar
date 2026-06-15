# 运行期配置中心设计（模型接入多 Key + 数据来源入库）

> 把两类「本应在后台维护、却仍散落在 env / 硬编码里」的配置收敛进数据库，由设置页统一管理：
> **(A) AI 模型接入** —— 选模型类型 → 填配置 → 一个配置挂**多把 API Key** 做故障转移 → 选启用哪个；
> **(B) 数据来源与采集连接器** —— 监控哪些来源走数据表、后台勾选控制轮询哪些「爬虫计划」，Reddit 凭据入库且**必须配置才能选**。
> 本文是落地前的设计方案。

- **状态**：设计待评审（未实现）
- **日期**：2026-06-14
- **范围**：`apps/server`（env→DB 收敛、连接器/来源 repository、调度器改读 DB、热重载、故障转移）、`apps/web`（`/settings` 扩成模型接入 + 数据来源两区）、`packages/db`（追加表）
- **不在范围**：Reddit 爬虫采集器本身的实现（见 [[reddit-ingestion-scraping-pivot]]，另起 demo 子项目验证）；账户/权限本身（见 `docs/account-rbac-design.md`，本文只复用其 `settings:manage` 能力闸）
- **关系**：本文是 [analyzer-redesign-plan](analyzer-redesign-plan) 的**增量续作**——M1–M5 已把单 Key 模型配置入库，本文加「多 Key 备用」并把**数据来源/采集凭据**也按同一范式入库。

---

## 1. 背景与现状（先澄清一个误会）

### 1.1 AI 模型 Key —— 其实已经入库了，env 只是启动兜底

提问「为什么 `ANTHROPIC_API_KEY` 还在 env 里维护」的直觉是对的方向，但**现状已经不是 env 维护**：

- 权威来源是 DB 表 `model_providers`（`provider/label/api_key/base_url/model/enabled`），`api_key` 列以 **AES-256-GCM 密文**入库（[apps/server/src/utils/crypto.ts](apps/server/src/utils/crypto.ts)，密钥由 `SETTINGS_SECRET` 派生）。
- 设置页 [`/settings`](apps/web) 已能增删改、测连通、选「启用中的 provider」（`app_settings.active_provider_id`），保存即热重载（`reloadAnalysisConfig()`，不重启进程）。
- env 里的 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 现在**只在首启、且 DB 为空时**被 `seedProvidersFromEnvIfEmpty()` 迁移进库一次（[apps/server/src/analysis/analysis-config.service.ts](apps/server/src/analysis/analysis-config.service.ts)）；DB 一旦有行，env 完全被忽略。

**那为什么还觉得"在 env 维护"？** 因为 [apps/server/.env.example](apps/server/.env.example) 仍把「AI 模型」做成一个显眼的必填式区块，读 `.env.example` 的人自然以为这是维护入口。所以这块的真问题是两个，而非「还没入库」：

1. **env 的定位没收口**：本设计据用户拍板**彻底移除** env 里的模型/Reddit 密钥（连一次性播种也不留），不再有任何 env 维护面（见 §3.4 / §4.3）。
2. **缺多 Key 备用**：现在一条 `model_providers` 只有**一把** `api_key`。你要的「一个模型配置挂多把 Key 做备用/容灾」还没有。

### 1.2 数据来源与 Reddit 凭据 —— 这才是真正还散在外面的部分

| 配置                  | 现状位置                             | 文件                                                                                                                                                |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 订阅的 subreddit 列表 | **硬编码数组**                       | [apps/server/src/config/subreddits.ts](apps/server/src/config/subreddits.ts)（`entrepreneur/startups/indiehackers/SaaS/SomebodyMakeThis/AppIdeas`） |
| HN 板块               | **硬编码数组**                       | [apps/server/src/config/feeds.ts](apps/server/src/config/feeds.ts)（`askstories→ask_hn`、`showstories→show_hn`、`topstories→hackernews_top`）       |
| RSS 源                | **硬编码数组**                       | [apps/server/src/config/feeds.ts](apps/server/src/config/feeds.ts)（`techcrunch`、`yc_blog`）                                                       |
| Reddit 凭据           | **env（5 项全或全无）**              | [apps/server/src/config/env.ts](apps/server/src/config/env.ts)：`REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD/USER_AGENT`                              |
| 调度遍历              | 直接 `for (const sub of SUBREDDITS)` | [apps/server/src/scheduler/scheduler.service.ts](apps/server/src/scheduler/scheduler.service.ts) `scan()`                                           |
| Reddit 客户端         | env 有则注入、无则 `null`            | [apps/server/src/crawler/crawler.module.ts](apps/server/src/crawler/crawler.module.ts)                                                              |

数据库里**没有「来源」实体**：来源只是 `posts.source`（reddit/hackernews/rss）+ `posts.subreddit`（频道别名）两列的隐式组合。要做到「后台勾选控制跑哪些爬虫计划」「Reddit 凭据入库」，需要把来源和连接器都升级为一等的、可配置的 DB 实体。

### 1.3 ⚠️ Reddit 与「爬虫转向」的张力（务必先读）

[[reddit-ingestion-scraping-pivot]] 已拍板：**Reddit 官方 Data API 对本项目实质作废**（商用 $12k/年起、停发免费 key、且 Reddit 在起诉爬虫商）。现有 [apps/server/src/crawler/reddit.ts](apps/server/src/crawler/reddit.ts) 的 OAuth 客户端属「实质作废」，采集要转向独立 demo 子项目里的 stealth 爬虫。

因此本设计**不把 Reddit 连接器钉死在 OAuth 上**：连接器凭据以「鉴权方式（`auth_kind`）+ 加密 JSON」存储——

- `auth_kind=oauth`（现状、过渡）：JSON 即现在的 5 个 env 字段；
- `auth_kind=scrape`（未来，爬虫 demo 验证通过后）：JSON 改放代理地址 / cookie / 指纹等，**不改表结构**。

「Reddit 必须填了配置才能选」这条门禁与 `auth_kind` 无关，两种形态都成立。这样既满足你「把 Reddit 凭据入库 + 门禁」的诉求，又不会为一条已知要死的 OAuth 通道反复改 schema。

---

## 2. 核心设计决策摘要

| #   | 决策            | 取值                                                                                                                                                                                                            | 来源            |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| C1  | 模型 Key 多备份 | 一条 `model_providers` 1:N 挂多把 `provider_api_keys`，按优先级故障转移                                                                                                                                         | 用户拍板        |
| C2  | 故障转移粒度    | **单次任务执行内**逐把切换（429/鉴权失败→冷却该 Key→换下一把），非「整任务失败再重试」                                                                                                                          | 推荐            |
| C3  | env 密钥退场    | **彻底删除**：移除 `seedProvidersFromEnvIfEmpty`/`seedRedditConnectorFromEnvIfEmpty` 与全部模型/Reddit 密钥 env（`AI_PROVIDER`/`*_API_KEY`/`*_MODEL`/`*_BASE_URL`/`REDDIT_*`），接入凭据纯靠设置页（§3.4/§4.3） | 用户拍板        |
| C4  | 来源入库        | 新增 `sources` 表，一行 = 一个「爬虫计划」，`enabled` 即后台勾选；种子来自现硬编码数组                                                                                                                          | 用户拍板        |
| C5  | 采集连接器入库  | 新增 `source_connectors` 表，存需鉴权平台（Reddit）的加密凭据；`auth_kind` 抽象 OAuth/爬虫                                                                                                                      | 用户拍板 + 推荐 |
| C6  | Reddit 门禁     | 平台=reddit 的来源，**有可用 reddit 连接器**才允许 `enabled=true`（前端置灰 + 服务端强制 + 调度防御）                                                                                                           | 用户拍板        |
| C7  | 加密复用        | 连接器凭据沿用 `utils/crypto.ts` 的 AES-256-GCM + `SETTINGS_SECRET`，与模型 Key 同套                                                                                                                            | 复用现范式      |
| C8  | 热重载          | 连接器变更 → bump `crawler_config_version` → 重建 Reddit 客户端；来源变更无需 version（调度每 cron tick 重读 DB）                                                                                               | 推荐            |
| C9  | 主键/时间       | 配置表沿用 `Int autoincrement` + `BigInt` Unix 秒（与 `model_providers`/`analysis_jobs` 一致）                                                                                                                  | 复用现约定      |
| C10 | 权限闸          | 模型与来源管理统归 `settings:manage`（如需细分另加 `sources:manage`，见 §6）                                                                                                                                    | 推荐            |
| C11 | 落地节奏        | 分两期：**Phase A** 模型多 Key（小、改现成）；**Phase B** 来源/连接器入库（大、净新增）                                                                                                                         | 推荐            |

---

## 3. 子系统 A：AI 模型接入 —— 一个配置，多把 Key

### 3.1 目标语义（对齐你的描述）

> 「下拉列表选模型类型，然后赋予相关配置信息，最后是选择启用哪个配置。这样还能支持一个模型配置多个 API KEY 做备用。」

- **选模型类型** = `model_providers.provider`（`anthropic` / `openai` / `deepseek` 下拉，已有 `provider_kind` enum）。
- **赋予配置信息** = `label` / `base_url` / `model`，外加 **一组** Key（新增）。
- **选启用哪个配置** = `app_settings.active_provider_id`（已有）。
- **多 Key 备用**（新增）= 一条 provider 下挂多把 `provider_api_keys`，调用时按优先级挑「启用且健康」的一把；遇限流/鉴权失败即冷却并切下一把。

### 3.2 数据模型（拆 Key 出独立表，1:N）

把 `model_providers.api_key`（单把）拆成子表 `provider_api_keys`（多把）。这样每把 Key 能各自带优先级、启停、健康状态、冷却时间——是 JSON 数组塞不下的（无法逐把脱敏/标状态）。

```prisma
/// 模型接入配置：选定 provider 类型后的一套接入参数。api_key 移到子表 provider_api_keys。
model model_providers {
  id         Int           @id @default(autoincrement())
  provider   provider_kind
  label      String
  base_url   String?
  model      String
  enabled    Boolean       @default(true)
  created_at BigInt
  updated_at BigInt
  keys       provider_api_keys[]   // 1:N，故障转移池
}

/// 一个模型配置可挂多把 API Key 做备用/容灾。
/// 调用时按 priority 升序取「enabled 且 status=active」的一把；失败即冷却该把、换下一把（§3.3）。
model provider_api_keys {
  id             Int             @id @default(autoincrement())
  provider_id    Int
  label          String          @default("")   /// "主号" / "备用1"，UI 区分用
  api_key        String          /// AES-256-GCM 密文（复用 utils/crypto.ts）；明文永不外发
  priority       Int             @default(0)     /// 越小越先用
  enabled        Boolean         @default(true)  /// 人工停用即移出池
  status         api_key_status  @default(active)/// 运行期健康态（见下）
  cooldown_until BigInt?         /// cooling 的解冻时刻（epoch 秒），到点自动回 active
  last_error     String?         /// 最近失败原因，排查用
  created_at     BigInt
  updated_at     BigInt
  provider       model_providers @relation(fields: [provider_id], references: [id], onDelete: Cascade)

  @@index([provider_id], map: "idx_provider_keys_provider")
}

/// API Key 运行期健康态。
enum api_key_status {
  active    /// 可用
  cooling   /// 触发限流(429)，冷却到 cooldown_until 自动恢复
  invalid   /// 鉴权失败(401/403)或额度耗尽，需人工处理（不自动恢复）
}
```

> **迁移**（additive）：建 `provider_api_keys` + enum；把每条 `model_providers` 现有 `api_key` 搬一行进子表（`priority=0, enabled=true, status=active, label='primary'`）；再删 `model_providers.api_key` 列。一条数据迁移 SQL 即可，无需清库。

### 3.3 故障转移语义（C2）

调用点在 worker 取 processor 时（`getProcessorForProvider(provider_id)`，[analysis-config.service.ts](apps/server/src/analysis/analysis-config.service.ts)）。改为「取一把可用 Key 构建 client」，并在**单次任务执行内**容错切换：

```
selectKey(provider):
  candidates = keys(provider) where enabled and (status=active
                 or (status=cooling and cooldown_until <= now))   # 到点解冻
  按 priority 升序、同序按 id；取第一把；空 → 该 provider 无可用 Key（任务失败，提示去补 Key）

analyze(post):
  for key in candidates (按序):
    try: return callModel(key)                # 成功即返回
    catch e:
      if e is 429/限流:      mark key cooling, cooldown_until = now + backoff(指数, 上限如15min)
      elif e is 401/403/额度: mark key invalid
      else:                  # 非 Key 相关错误（网络/超时/模型 5xx）
         不动 Key 状态，沿用既有的 provider 自带 3 次退避；仍失败 → 抛出（任务按原机制重试）
      continue 下一把
  抛出「所有 Key 均不可用」                       # 任务失败，看板可见、可人工处理
```

要点：

- **冷却自愈**：`cooling` 到 `cooldown_until` 自动回 `active`（select 时判定即可，无需后台扫表）；`invalid` 需人工（改/换 Key 后在 UI 复位）。
- **`active_provider_id` 不变**：仍指向「逻辑 provider」，Key 选择是 provider 内部细节；`analysis_jobs.provider_id` 也不动。可在 job 的 `model`/`error` 或新增可空 `metadata` 里记下「本次用了哪把 Key」便于对账（可选）。
- **与现有 provider 级重试不冲突**：provider 实现（anthropic/openai-compatible）自带的 3 次退避只兜「同一把 Key 的瞬时抖动」；Key 间切换是更外层一圈。

### 3.4 env 模型密钥退场（C3，用户拍板：彻底删）

- **移除** `seedProvidersFromEnvIfEmpty()`，以及 env 里的 `AI_PROVIDER` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `*_MODEL` / `*_BASE_URL`（连同 [env.ts](apps/server/src/config/env.ts) 的 `resolveAnalysis()` 与相关校验）。**env 里不再出现任何模型密钥**。
- [.env.example](apps/server/.env.example) 删掉整个「AI 模型」段；README 改为「模型接入唯一入口 = `/settings`」。
- **首启引导**：全新部署、DB 无 provider 时分析跑不起来——`/analyze` 工作台已有「未配置模型 → 引导去设置页」的空状态（[analyzer-redesign-plan](analyzer-redesign-plan) 既有），它从「边角情况」转正为「首次部署的正常首步」。`SETTINGS_SECRET` 仍是 env 必填（否则无从加密 Key）。
- **`pnpm analyze` 一次性 CLI**（`analyze-once.ts`）原走 env `createProcessor`，改为读 DB 的启用中 provider（无则报错引导去设置页），否则会随 env 删除而失效。

### 3.5 API / 设置页（在现有 `/settings` 上加 Key 管理）

服务端 [settings.controller.ts](apps/server/src/http/settings.controller.ts) 在现有 provider CRUD 基础上加嵌套 Key 端点：

| 方法     | 路径                                           | 作用                                                  |
| -------- | ---------------------------------------------- | ----------------------------------------------------- |
| `POST`   | `/api/settings/providers/:id/keys`             | 加一把 Key（密文入库；需 `SETTINGS_SECRET`）          |
| `PUT`    | `/api/settings/providers/:id/keys/:keyId`      | 改备注/优先级/启停；`status=invalid` 复位为 active    |
| `DELETE` | `/api/settings/providers/:id/keys/:keyId`      | 删 Key（至少保留一把可用才允许置 provider 为 active） |
| `POST`   | `/api/settings/providers/:id/keys/:keyId/test` | 单把连通性测试                                        |

`toProviderDTO` 改为返回**每把 Key 的脱敏摘要**（`{id,label,priority,enabled,status,keyMasked:"sk-a…wxyz",cooldownUntil}`），明文永不外发——沿用现有 `maskKey()`。

UI（`@hatch-radar/ui` shadcn，[[web-ui-shadcn-convention]]）：

```
设置 ▸ 模型接入                                        [ + 新建模型配置 ]
┌─ Anthropic · 主力 Claude ──────────────────  ● 启用中  ⋯ ─┐
│  模型 claude-opus-4-8     base_url 默认                     │
│  API Keys (2)                                  [ + 添加 Key ]│
│   ① 主号    sk-a…wxyz   优先级0  ● active                 ⋯ │
│   ② 备用1   sk-b…mnop   优先级1  ◐ cooling(7min)          ⋯ │
└──────────────────────────────────────────────────────────┘
┌─ DeepSeek · 备用便宜档 ─────────────────────  ○ 未启用  ⋯ ─┐
│  …                                                          │
└──────────────────────────────────────────────────────────┘
   行内 ⋯：编辑配置 / 测试 / 设为启用 / 删除
   Key 行 ⋯：编辑(备注/优先级/启停) / 测试这把 / 复位invalid / 删除
   组件：Card/Table/Dialog/Form/Select/Switch/Badge
```

---

## 4. 子系统 B：数据来源与采集连接器入库

### 4.1 目标语义（对齐你的描述）

> 「监控哪些来源走数据表控制，后台通过勾选控制轮询要跑哪些爬虫计划；种子就把当前写在代理里的这些；Reddit 必须填了配置才能选。」

拆成两层（与 §3 的「连接器 vs Key」「provider vs active」同构）：

- **`sources`（爬虫计划）**：一行 = 一个要轮询的来源（一个 subreddit / 一个 HN 板块 / 一个 RSS 源）。`enabled` 就是后台的勾选框；勾上才进调度。
- **`source_connectors`（采集连接器/凭据）**：需鉴权的平台（Reddit）才有；存加密凭据 + 连通状态。HN/RSS 无需凭据，故无连接器。

### 4.2 数据模型

```prisma
/// 采集目标（「爬虫计划」）：一行 = 一个要轮询的来源。enabled 即后台勾选开关。
/// 种子来自原 config/subreddits.ts 与 config/feeds.ts。
model sources {
  id          Int             @id @default(autoincrement())
  platform    source_platform
  /// 平台内标识：reddit=subreddit 名；hackernews=endpoint(askstories…)；rss=feed url。
  identifier  String
  /// 展示名 / 频道别名（reddit 可同标识；hackernews 如 ask_hn；rss 如 techcrunch）。
  label       String          @default("")
  /// 平台特定参数(JSON)：reddit={sorts:["hot","new"],limit:25}；hackernews/rss 可空。
  config      Json?
  /// 是否纳入轮询（= 后台勾选）。platform=reddit 时需有可用 reddit 连接器才允许 true（§4.5）。
  enabled     Boolean         @default(true)
  created_at  BigInt
  updated_at  BigInt

  @@unique([platform, identifier], map: "uniq_sources_platform_ident")
  @@index([platform, enabled], map: "idx_sources_enabled")
}

/// 需鉴权平台的采集连接器（现状仅 Reddit）。凭据以加密 JSON 存，auth_kind 决定其形状。
/// 同一平台可有多条（多账号/多代理）→ 与模型多 Key 同构的故障转移（可选启用）。
model source_connectors {
  id               Int             @id @default(autoincrement())
  platform         source_platform
  label            String          @default("")
  /// 鉴权方式：oauth(现状/过渡，官方API) | scrape(未来，代理+cookie，见 §1.3)。
  auth_kind        connector_auth
  /// 加密(AES-256-GCM)的凭据 JSON。oauth:{clientId,clientSecret,username,password,userAgent}
  secret           String
  enabled          Boolean         @default(true)
  priority         Int             @default(0)   /// 多连接器时的选用顺序
  /// 最近一次「测试连接」结果，供 UI 显示健康度与门禁判定。
  last_check_ok    Boolean?
  last_check_at    BigInt?
  last_check_error String?
  created_at       BigInt
  updated_at       BigInt

  @@index([platform], map: "idx_connectors_platform")
}

/// 数据来源平台。
enum source_platform {
  reddit
  hackernews
  rss
}

/// 连接器鉴权方式。
enum connector_auth {
  oauth    /// 官方 API（现状，实质作废，过渡保留）
  scrape   /// 自托管爬虫（代理/cookie），爬虫 demo 验证通过后启用
}
```

> 多 `source_connectors`/平台（不设 platform 唯一约束）顺带给 Reddit「多账号/多代理故障转移」留了路，与 §3 模型多 Key 同构——但 Phase B 先做单连接器，多连接器选用顺序作可选增强。

### 4.3 种子迁移（C4：把硬编码当种子）

新增 `seedSourcesIfEmpty()`（从**代码常量**播种来源列表，非 env），首启且 `sources` 为空时写入现硬编码值：

| platform   | identifier                                                                  | label                             | config                           | enabled |
| ---------- | --------------------------------------------------------------------------- | --------------------------------- | -------------------------------- | :-----: |
| reddit     | entrepreneur / startups / indiehackers / SaaS / SomebodyMakeThis / AppIdeas | 同 identifier                     | `{sorts:["hot","new"],limit:25}` |   ✅    |
| hackernews | askstories / showstories / topstories                                       | ask_hn / show_hn / hackernews_top | —                                |   ✅    |
| rss        | https://techcrunch.com/feed/ / https://www.ycombinator.com/blog/rss.xml     | techcrunch / yc_blog              | —                                |   ✅    |

Reddit 凭据：**不做 env 播种**（与 §3.4 同此拍板——env 里不再出现任何密钥）。移除 env 的 `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD/USER_AGENT` 及其全或全无校验；Reddit 连接器**只在设置页配置**。注意 `seedSourcesIfEmpty()` 只播种来源**列表**（来自代码常量），**不含任何凭据**——两者别混。

迁移后 [config/subreddits.ts](apps/server/src/config/subreddits.ts) 与 [config/feeds.ts](apps/server/src/config/feeds.ts) 从「运行期真相源」降级为「种子常量」（挪进 seed 模块或保留供 seed 引用），调度器不再直接 import。

### 4.4 调度器改造（读 DB，C8）

[scheduler.service.ts](apps/server/src/scheduler/scheduler.service.ts) 的 `scan()` / `comments()` 把硬编码遍历换成 DB 查询：

```
scan():                       # 每 cron tick 现查，天然「下一轮生效」，无需热重载机制
  redditSources = sources(platform=reddit, enabled=true)
  if redditSources 非空:
     conn = activeRedditConnector()           # enabled 且 last_check_ok 的最优先一条
     if conn: for s in redditSources: redditClient(conn).fetchListing(s.identifier, s.config.sorts, s.config.limit)
     else:    log.warn 跳过 reddit（无可用连接器）  # 防御：UI 本不该让它 enabled
  for s in sources(platform=hackernews, enabled=true): hn.fetchStories(s.identifier)
  for s in sources(platform=rss,        enabled=true): fetchFeed(s.identifier, s.label)
```

- **来源变更不需 version**：cron 每 30 分钟重读 `sources`，改完最迟下一轮生效，符合直觉。
- **连接器变更需热重载**：Reddit 客户端会 fetch token 并持有，改凭据要重建——见 §4.6。

### 4.5 Reddit 门禁（C6：必须配置才能选）

三道一致的闸：

1. **前端**：来源表里 `platform=reddit` 的行，若无「可用 reddit 连接器」（enabled 且最近测试 OK），其 `enabled` 勾选框**置灰** + Tooltip「请先在『采集连接器』配置并测试通过 Reddit 凭据」。
2. **服务端**：`PUT /api/sources/:id` 把 reddit 源置 `enabled=true` 时，校验存在可用 reddit 连接器，否则 `400`。
3. **调度防御**：`scan()` 即便读到 enabled 的 reddit 源、但无可用连接器，也跳过并告警（兜前端漏判）。

「可用」判定：`source_connectors` 有 `platform=reddit && enabled=true` 且 `last_check_ok=true`（要求先点过「测试连接」并通过，避免填错就放行）。

### 4.6 连接器热重载（C8）

仿 `reloadAnalysisConfig`：连接器 CRUD 后 bump `app_settings.crawler_config_version`；持有 Reddit 客户端的地方（[crawler.module.ts](apps/server/src/crawler/crawler.module.ts) 现在是 boot 期 env 注入的单例）改为**惰性按 DB 凭据构建 + 版本变更即重建**。无 Reddit 连接器时客户端为 `null`，`scan()` 跳过 reddit（行为同「未配 Reddit 连接器」）。

### 4.7 API / 设置页（`/settings` 加「数据来源」区）

| 方法                  | 路径                              | 作用                                                                      |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `GET`                 | `/api/sources`                    | 列来源（按平台分组）+ 连接器健康摘要                                      |
| `POST`/`PUT`/`DELETE` | `/api/sources[/:id]`              | 来源增删改；`PUT` 改 `enabled`（勾选）走 §4.5 门禁                        |
| `GET`                 | `/api/source-connectors`          | 列连接器（凭据脱敏）                                                      |
| `POST`/`PUT`/`DELETE` | `/api/source-connectors[/:id]`    | 连接器增删改（凭据密文入库；改 base/平台需重填凭据，仿模型 Key 防泄露闸） |
| `POST`                | `/api/source-connectors/:id/test` | 测试连接，写 `last_check_*`（门禁依赖它）                                 |

UI：

```
设置 ▸ 数据来源
┌─ 采集连接器 ───────────────────────────────  [ + 新建连接器 ] ─┐
│ Reddit · 主账号   oauth   ● 启用  ✅ 测试通过 2h前   [测试] ⋯ │
│   ⚠️ 官方 API 已知作废风险——爬虫方案见 reddit-ingestion 备忘    │
└────────────────────────────────────────────────────────────────┘
┌─ 爬虫计划（勾选启用） ──────────────────────  [ + 新建来源 ] ──┐
│ Reddit    ☑ entrepreneur  ☑ startups  ☑ SaaS  ☐ …             │
│           （无可用 Reddit 连接器时整组置灰）                    │
│ HackerNews☑ ask_hn  ☑ show_hn  ☑ hackernews_top               │
│ RSS       ☑ techcrunch  ☑ yc_blog                             │
└────────────────────────────────────────────────────────────────┘
   组件：Card/Table/Checkbox/Switch/Badge/Dialog/Form/AlertDialog/Tooltip
```

---

## 5. 数据库设计汇总

新增 **3 表 + 3 enum**，改 1 表（`model_providers` 去 `api_key` 列、加 `keys` 关系），纯追加 + 一次数据迁移，不动业务表：

- 新表：`provider_api_keys`、`sources`、`source_connectors`
- 新 enum：`api_key_status`、`source_platform`、`connector_auth`
- 改表：`model_providers`（拆 Key 出去）
- 新 `app_settings` 键：`crawler_config_version`（连接器热重载用）

迁移命名建议 `add_runtime_config`，与既有迁移并存；类型经 `@hatch-radar/db` 导出给 web 与 server（约定见 [[server-nest-pg-refactor]]）。Schema 全部沿用 snake_case 表名、`Int autoincrement` 主键、`BigInt` Unix 秒（与 `model_providers`/`analysis_jobs` 对齐）。

---

## 6. 与账户 RBAC 的关系

`docs/account-rbac-design.md` 的能力目录已有 `settings:manage`（标注「模型与密钥管理」，敏感 ⚠️），守 `/settings` 与 `server /api/settings/*`。本文新增的来源/连接器管理：

- **推荐**：直接归入 `settings:manage`（都是「系统管理」面，省一个能力位），把其释义从「模型与密钥」扩成「模型接入与数据来源管理」。
- **可选**：若要让「能配来源但不能碰模型计费密钥」的更细分工，新增并列能力 `sources:manage`（来源/连接器）与 `settings:manage`（模型/Key）分治。

任一方式都把 `/api/sources*`、`/api/source-connectors*` 纳入对应能力闸，沿用 RBAC 的服务端 `requirePermission`。**本文不依赖 RBAC 先落地**——RBAC 没上时这些端点仍由现有 `API_TOKEN`（`BearerAuthGuard`）守，与 `/api/settings/*` 同级。

---

## 7. 安全清单

- [x] 模型 Key、Reddit 凭据均 **AES-256-GCM 密文入库**（复用 `utils/crypto.ts` + `SETTINGS_SECRET`），明文永不外发；DTO 仅给脱敏摘要。
- [x] 改 `base_url`/平台等「可被用来转移密钥外发」的字段时，**强制重填凭据**（仿现有模型 Key 闸）。
- [x] `provider_api_keys`/`source_connectors` 的连通性测试结果只存布尔 + 错误串，不回明文。
- [x] Reddit 门禁三道闸（前端置灰 / 服务端 400 / 调度防御），避免「填错就开抓」。
- [x] 管理端点纳入 `settings:manage`（或 `sources:manage`）能力闸；RBAC 未上时维持 `API_TOKEN`。
- [ ] 未来：Key/凭据变更与「设为启用」「故障转移触发」写 `audit_logs`（RBAC 落地后接入，[[account-rbac-design]] §7）。

---

## 8. 实施计划（C11 分两期）

### Phase A — 模型多 Key 故障转移（小，改现成）

| 步骤 | 内容                                                                                                                                                                                         | 主要文件                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A.1  | 加 `provider_api_keys` + `api_key_status`；迁移搬运现有 Key；删 `model_providers.api_key`                                                                                                    | `packages/db/prisma/schema.prisma` + 迁移                                                  |
| A.2  | providers.repository 改为管理 Key 池；`toProviderDTO` 出 Key 脱敏摘要                                                                                                                        | `apps/server/src/db/providers.repository.ts`                                               |
| A.3  | `selectKey` + 单任务内故障转移 + 冷却自愈                                                                                                                                                    | `apps/server/src/analysis/analysis-config.service.ts`、`worker/worker.service.ts`          |
| A.4  | settings.controller 加嵌套 Key 端点（CRUD + 单把 test + 复位）                                                                                                                               | `apps/server/src/http/settings.controller.ts`                                              |
| A.5  | `/settings` 模型区加 Key 池管理 UI                                                                                                                                                           | `apps/web`（`/settings`）                                                                  |
| A.6  | **删 env 模型密钥路径**：移除 `seedProvidersFromEnvIfEmpty` 与 `AI_PROVIDER`/`*_API_KEY`/`*_MODEL`/`*_BASE_URL`、`resolveAnalysis()`；`analyze-once` 改读 DB；删 `.env.example`「AI 模型」段 | `config/env.ts`、`analysis-config.service.ts`、`analyze-once.ts`、`.env.example`、`README` |

### Phase B — 数据来源 / 连接器入库（大，净新增）

| 步骤 | 内容                                                                                                                     | 主要文件                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| B.1  | 加 `sources`/`source_connectors` + `source_platform`/`connector_auth` enum + `crawler_config_version`                    | `packages/db/prisma/schema.prisma` + 迁移                                        |
| B.2  | sources/connectors repository（凭据加密入库、脱敏 DTO）                                                                  | `apps/server/src/db/*.repository.ts`                                             |
| B.3  | 种子：`seedSourcesIfEmpty`（来源列表，来自代码常量）；Reddit 凭据**无 env 播种**、仅设置页配；移除 `REDDIT_*` env 与校验 | `apps/server/src/analysis`(或新 ingestion config service)、`config/env.ts`       |
| B.4  | 调度器 `scan()`/`comments()` 改读 DB；硬编码降级为种子常量                                                               | `apps/server/src/scheduler/scheduler.service.ts`、`config/{subreddits,feeds}.ts` |
| B.5  | Reddit 客户端惰性按 DB 凭据构建 + 连接器热重载（bump version 重建）                                                      | `apps/server/src/crawler/crawler.module.ts`、`crawler/reddit.ts`                 |
| B.6  | sources/connectors 端点 + Reddit 门禁三道闸                                                                              | `apps/server/src/http/*.controller.ts`                                           |
| B.7  | `/settings` 加「数据来源」区（连接器卡 + 来源勾选表）                                                                    | `apps/web`（`/settings`）                                                        |
| B.8  | **删 env Reddit 凭据路径**：移除 `REDDIT_*` env 与校验、删 `.env.example` Reddit 段、README 改「Reddit 凭据去设置页」    | `config/env.ts`、`apps/server/.env.example`、`README`                            |

> A、B 互不阻塞，可并行或先 A 后 B。两期都在 [analyzer-redesign-plan](analyzer-redesign-plan) 已建的设置页/加密/热重载地基上加法。

---

## 9. 决策记录（已定稿）

> 原为待拍板项；用户 2026-06-14「同意」后全部按推荐采纳，正文即终态。

1. ~~**D1 — env 模型 Key 是否彻底删除？**~~ **已拍板：彻底删除**（2026-06-14）。移除 `seedProvidersFromEnvIfEmpty` 与全部模型密钥 env，模型接入纯靠设置页；为一致性，Reddit 凭据（`seedRedditConnectorFromEnvIfEmpty` + `REDDIT_*` env）一并删除。env 中仅留 `SETTINGS_SECRET`（解密主密钥）与进程级参数。详见 §3.4 / §4.3 / 附表。
2. **D2 — 多 Key 故障转移粒度** → **采纳**「单任务内逐把切换」（C2）。
3. **D3 — 来源管理能力位** → **采纳**并入 `settings:manage`（C10/§6），暂不拆 `sources:manage`；将来要细分工再加。
4. **D4 — Reddit「可用」判定** → **采纳**「必须测试通过（`last_check_ok=true`）才解禁来源」（§4.5），避免填错就空抓。
5. **D5 — 多连接器/平台（Reddit 多账号代理故障转移）** → **采纳**：Phase B 先做单连接器；多连接器选用顺序作可选增强（schema 已支持，本期不实现）。

---

## 10. 取舍与未来扩展

- **Key/凭据用子表而非 JSON 数组**：换来逐把脱敏、状态机、优先级、冷却——JSON blob 做不到。代价是多一张表 + 一次数据迁移，值得。
- **来源不引「每源独立 cron」**：调度节奏保持全局（每 30 分钟），来源只控「跑不跑」。要按源定制频率是后续事（可在 `sources.config` 加 `cadence` 再由调度分桶）。
- **Reddit OAuth 过渡保留**：明知作废仍保 `auth_kind=oauth`，是为不阻断现有少量可跑场景；`scrape` 形态待 demo 验证（[[reddit-ingestion-scraping-pivot]]）通过后追加，**不改表**。
- **故障转移不跨 provider**：只在同一逻辑 provider 的 Key 池内切；「Anthropic 全挂了自动切 DeepSeek」是更激进的跨档降级，本期不做（可后续在 `active_provider_id` 上叠「备选 provider 链」）。

---

## 附：env → DB 迁移对照

| 现 env                                                                   | 去向                                                       | 入口                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------ |
| `AI_PROVIDER`                                                            | `model_providers.provider` + `active_provider_id`          | 设置页·模型接入          |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`              | `provider_api_keys.api_key`（密文，可多把）                | 设置页·模型接入·Key 池   |
| `*_MODEL` / `*_BASE_URL`                                                 | `model_providers.model` / `base_url`                       | 设置页·模型接入          |
| `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD/USER_AGENT`                   | `source_connectors.secret`（加密 JSON, `auth_kind=oauth`） | 设置页·数据来源·连接器   |
| `SUBREDDITS` / `HN_SECTIONS` / `RSS_FEEDS`（硬编码）                     | `sources` 行（`enabled` 勾选）                             | 设置页·数据来源·爬虫计划 |
| `SETTINGS_SECRET`                                                        | **留在 env**（解密主密钥，不可入库——它是用来解库里密文的） | env（必填）              |
| `DATABASE_URL` / `API_TOKEN` / `HTTP_PORT` / `WORKER_*` / `LOG_LEVEL` 等 | **留在 env**（启动期/进程级配置，非运行期可调）            | env                      |

> 收口原则：**「解密用的主密钥」与「进程启动/拓扑参数」留 env；「业务可调的接入点与来源」入库**。据用户拍板，上表 1–4 行的 env 变量**直接删除、不再读取、也不做一次性播种**（[analyzer-redesign-plan](analyzer-redesign-plan) 既有的 env→DB 播种逻辑一并移除）；第 5 行硬编码常量仍作**来源列表**种子保留（不含任何凭据）。全新部署经 `/settings` 首配模型与 Reddit 连接器。
