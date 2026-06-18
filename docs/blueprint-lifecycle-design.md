# 图纸驱动的抓取生命周期（Blueprint Lifecycle）设计

> 用「图纸 → 进程 → 任务 → 环节」一套统一执行模型，取代现有散落的 `@Cron` 自动轮询，重排「采集 → 复查 → 分析」全生命周期；并引入**全局出站请求闸**，把所有外站请求收口到一条可观测、可暂停、可编排的有序队列里，降低被封控概率。

> **实现状态（2026-06-18）**：定稿未实现。
>
> **与现有设计的关系**：
>
> - **取代**现状四个 `@Cron`（`scan`/`comments`/`analyze`/`archive`，见 [scheduler.service.ts](../apps/api/src/domain/scheduler/scheduler.service.ts)）的自动轮询。
> - **推广** [流水线检视器](pipeline-inspector-design.md)：检视器的「环节 + 检查点 + 重认领」不再是分析任务的「特殊模式」，而是**所有任务的通用执行模型**。`job_steps`/`analysis_jobs` 泛化为 `task_stages`/`tasks`。
> - **本次改版清库重建**（greenfield schema）：不做增量迁移，旧 `analysis_jobs`/`job_steps` 直接由新表替代。

---

## 一、背景与目标

### 痛点（现状为何混乱）

当前生命周期由 4 个硬编码 `@Cron` 方法 + 散落在 `posts` 上的多个状态位驱动：

| 现状机制                                              | 位置                                         | 问题                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `scan()` 每 30min 扫列表 + fire-and-forget 抓新帖评论 | `SchedulerService.scan`                      | 调度逻辑硬编码在代码里，无法配置、无法单独触发、无运行记录                                                               |
| `comments()` 每 30min 按热度策略补全评论              | `SchedulerService.comments`                  | 「该不该刷新」的策略埋在 `getPostsNeedingCommentRefresh` SQL 里，不可见不可调                                            |
| `analyze()` 每小时入队分析                            | `SchedulerService.analyze`                   | 与采集解耦到「最长延迟 1 小时」才分析；`PENDING_ANALYSIS_PREDICATE` 隐式                                                 |
| `TokenBucketQueue` 限速                               | [queue.ts](../packages/crawler/src/queue.ts) | **进程内内存态**：worker 可横向扩 N 个，每个各持一个桶 → 实际出站速率 = N × 单桶速率，**全局不可控、封控风险随扩容放大** |

三个根本问题：**① 调度不可见不可控**（写死在代码、无进程/任务记录）；**② 限速不是全局的**（多 worker 各自为政）；**③ 一条数据如何流动看不清**（检视器只覆盖了分析这一段）。

### 目标

1. **一切皆图纸**：抓取/复查/分析都建模为可配置、可单次/可定时/可间隔触发的「图纸」；每次执行产生一条**进程记录**，进程派生若干**任务**，任务由多个**环节**组成。全程有记录、可回看、可在 Web 上看清「图纸样貌 + 实时进度」。
2. **全局请求闸**：所有外站请求丢进**一条**有序队列，由**单实例**调度器按 per-lane 限速 + 全局/分 lane 暂停统一放行，Web 可视化其执行计划并手动暂停/恢复。
3. **可逐环节停起**：沿用检视器的「检查点 + 重认领」，把暂停能力下放到**任意任务的任意环节**——管理员可对某个环节挂「闸门」，任务跑到那一停，点继续再续跑。
4. **采集即分析**：采集/复查完一条帖子立即触发其分析（事件驱动），取代「每小时批量入队」。

---

## 二、统一执行模型

```
图纸 Blueprint   ──触发一次(单次/定时/间隔)──▶   进程 Run   ──派生 N──▶   任务 Task(=1帖)   ──含多个──▶   环节 Stage
  可复用定义                                     一次运行实例                kind/lineage              检查点 + 闸门
```

| 层   | 实体                   | 说明                                                                                                                          | 对应现状                  |
| ---- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 定义 | **图纸 `blueprints`**  | 一类可复用、可调度的流程：`kind`（collect/recheck/maintenance）+ 触发方式 + 参数                                              | 无（调度写死在 `@Cron`）  |
| 实例 | **进程 `runs`**        | 图纸的一次执行；有状态、计数、起止时间、（复查的）sweep 序号                                                                  | 无（仅日志）              |
| 单元 | **任务 `tasks`**       | 一个工作单元，绝大多数 = 一条帖子；`kind`（discover/collect/recheck/analyze/translate）+ `parent_task_id`（血缘，供树形展示） | `analysis_jobs`（仅分析） |
| 步骤 | **环节 `task_stages`** | 任务内的有名步骤，每步产物落库做检查点；可挂 `gate` 闸门                                                                      | `job_steps`（仅检视分析） |

### 关键洞察：检视器从「特例」升格为「通用执行内核」

检视器已经实现了「把一条任务拆成有名环节、每步落检查点、worker 跑完一步置 `paused` 后正常结束、续跑靠重认领」这套机制（见 [pipeline-inspector-design.md](pipeline-inspector-design.md) §三）。本设计只做两件事：

1. **往上加两层**：`blueprints`（图纸）/`runs`（进程）。
2. **往外推一层**：把「环节执行 + 检查点 + 闸门」从「仅分析任务」推广到「所有 kind 的任务」。

于是**不再有「普通模式 vs 检视模式」之分**——每个任务都是「环节序列 + 检查点」执行；区别只在于**哪些环节挂了闸门**（全不挂 = 一口气跑完；逐个挂 = 逐步检视；挂某几个 = 在关键点停）。检视器现有的 `runInspectJob`/`execNode`/`paused`/`resume` 即新执行内核的原型。

> **取舍**：现状刻意保留「普通分析不写 `job_steps`、零开销」的快路径（检视器 §九「不变」）。新模型**放弃**该优化，改为**所有任务都写环节检查点**——因为本设计的核心诉求就是「看清每条数据的流动 + 逐环节可控」。环节行很廉价（几行 jsonb），相对网络/AI 耗时可忽略；老 run 的环节随归档清理（见 §十）。

---

## 三、两类图纸

### 3.1 采集图纸（Collection）—— 只抓「新帖」

**触发**：单次（手动）/ 定时（cron 点位）。采集工作有界（受列表规模约束），适合规律的墙钟节奏。

**进程结构**（树形）：

```
Run（采集图纸 #N，定时触发）
└─ Task(discover)                      ← 进程的根任务：发现 + 去重 + 派生
   ├─ stage fetch_listing  （翻页抓列表，每页 1 个请求入闸）
   ├─ stage dedup          （候选 ID 反连接，决定哪些是新帖）
   └─ stage spawn          （为每条新帖派生一个 collect 子任务）
        ├─ Task(collect: 帖 A)         ← 每帖一个子任务
        │   ├─ stage fetch_detail      帖子详情
        │   ├─ stage fetch_comments    评论（含翻页嗅探，逐页入闸）
        │   ├─ stage persist           入库 + 记录源计数(num_comments)
        │   └─ Task(analyze: 帖 A)     ← persist 成功即派生分析子任务（见 3.3）
        ├─ Task(collect: 帖 B) ...
        └─ ...
```

**「进程产生任务」如何不重复抓（用户点名要解决的）—— 三层去重**：

| 层                     | 机制                                                                                                                                       | 防住什么                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| ① 职责切分（最关键）   | **采集只碰不在 `posts` 表里的帖**；任何已入库的帖一律交「复查图纸」接管，采集永不再 fetch                                                  | 采集与复查天然不抢同一帖；杜绝「每轮把热帖重抓一遍」                                       |
| ② 生成任务即反连接     | `dedup` 环节：候选 ID 集合 `EXCEPT (SELECT id FROM posts) EXCEPT (SELECT post_id FROM tasks WHERE status active)`，余下才派生 collect 任务 | 一次批量滤掉「已知」与「在途」                                                             |
| ③ 活跃任务部分唯一索引 | `UNIQUE(post_id, kind) WHERE status IN (queued,running,paused)`（沿用并泛化现有 `uniq_jobs_active_post`）                                  | 两个进程同秒抢同一条**新帖**（还没进 `posts`，前两层兜不住）时，先插的赢、后插的撞约束跳过 |

**附赠停止规则（增量爬虫收口）**：`fetch_listing` 翻页时，翻到「连续 K 条都命中已知帖」即停——既省请求又自然封顶发现深度（无需翻到列表尽头）。

### 3.2 复查图纸（Recheck）—— 只查「旧帖」探变化

**触发**：单次 / **间隔（推荐默认）** / 定时（提供但不推荐，理由见下）。

**定时 vs 间隔——结论：复查用间隔，定时对复查没必要**

| 维度         | 定时（墙钟点位，到点全量入队分批） | 间隔（一批跑完 + 冷却再下一批）     |
| ------------ | ---------------------------------- | ----------------------------------- |
| 节奏来源     | 与处理时长**无关**，到点就丢       | 上一批**跑完**后才计时下一批        |
| 堆积风险     | 上轮没跑完下轮又来 → **堆积/惊群** | 结构上**不可能堆积**（串行 + 反压） |
| 负载形状     | 入队瞬间**尖峰**                   | 平稳；inter-batch 间隔正好喂限速器  |
| 随吞吐自适应 | 否                                 | **是**（慢就自然拉长周期）          |
| 整轮周期     | 固定可预测                         | 浮动                                |

定时唯一优点是「时点可预测」，而复查**不需要**这个；且一旦给定时加上必须的「上轮还在跑就跳过」单例闸（否则堆积），它那点可预测性也没了。**故复查只用间隔**；定时留给采集（有界 + 想规律发现新内容）。间隔还有自平衡红利：退避让每轮越扫越少，语料「凉下来」后单轮更便宜、周期自动变长。

**间隔模式的运行形态**：一次 sweep = 把当前「到期」的帖全部纳入 → 按 `batch_size` 分批，每批跑完等 `batch_interval` 再下一批 → 队列排空即一次 sweep 完成 → 重算到期集合、`sweep_seq++`、开下一 sweep（持续循环）。每个 sweep 建一条 `run`（边界清晰、便于树形展示）；间隔调度器在上一 sweep-run 完成后开下一条。

**复查任务环节**：

```
Task(recheck: 帖 X)
├─ stage probe          1 个轻请求取「源现网评论数」，与基线对比（见下）
├─ (gate) 有变化？       否 → 标记未变、退避 +1、任务 skipped 结束
├─ stage recrawl        是 → 全量重抓评论（翻页嗅探，逐页入闸）
├─ stage persist        replaceComments 整删整插（自动对齐增/删）+ 刷新基线 + comments_changed_at
└─ Task(analyze: 帖 X)  变化 → 派生重新分析子任务（旧洞察已过时）
```

**变化检测——基线用 `posts.num_comments`，不要用 `COUNT(comments)`（重要修正）**

用户原始思路是「源现网评论总数 vs 我们入库的评论数对比」。直接拿源计数比 `COUNT(comments)` **有系统性偏差**：源站 `num_comments` 把删除/折叠/被移除的也计入，而 `replaceComments` 会丢弃折叠/超预算评论（即现状 `CommentFetchResult.dropped`）。于是「没变也不相等」→ 误判有变 → 白白重抓 → **退避失效**。

正确做法：用 **`posts.num_comments`（其语义已是「源站元数据计数」，即我们上次看到的源计数）作基线**：

```
变化 = probe 取到的源现值 ≠ posts.num_comments
```

它对我们的存储口径免疫，只跟「源侧到底动没动」挂钩，且**无需新增列**（首帖采集时 `num_comments` 已写入作初值）。判定有变后：recrawl + `replaceComments` + 把 `posts.num_comments` 刷成新值（新基线）。评论数掉了（删评）同样算「变化」，整删整插天然把增/删都对齐——所以严格说是「重抓 + 整体替换」而非纯增量。

> probe 成本：Reddit 取帖 `.json`/about、HN 取 item 的 `descendants`，单个轻请求即得计数，**不**拉评论树；只有判定有变才进 recrawl 的多请求翻页。

**指数退避 + 封顶（用户已拍板：指数、封顶、不引入时间概念）**

每帖维护 `recheck_misses`（连续未变次数）与 `recheck_due_sweep`（下次有资格被复查的 sweep 序号）：

```
某 sweep S 复查帖 X 后：
  有变化 → recheck_misses = 0;  recheck_due_sweep = S + 1            // 复位，下轮必查
  未变化 → recheck_misses++;     skip = min(2 ** (recheck_misses-1), CAP)
           recheck_due_sweep = S + skip                              // 跳过 1,2,4,8,…,CAP 轮
sweep S 的到期集合 = { 帖 | recheck_due_sweep ≤ S }
```

`CAP`（封顶跳过轮数，如 16）配置在复查图纸参数里。**不**映射到绝对时间。「连续未变 → 跳过翻倍 → 命中变化 → 复位 L0」即用户描述的「活跃多查、沉默渐少查、一旦再活跃就恢复资格」。

### 3.3 分析触发 —— 采集/复查完成即事件派生（取代 `analyze()` cron）

- collect 任务 `persist` 成功 **且** 当前有 active 模型 **且** 无该帖活跃 analyze 任务（索引 ③ 兜底）→ 派生 `Task(analyze)` 子任务，归属同一 run（树形里 collect→analyze 血缘清晰）。
- recheck 判定「有变化」并 recrawl 后 → 同样派生重新分析（旧洞察已过时）。这取代了现状 `PENDING_ANALYSIS_PREDICATE` 里 `comments_changed_at > analyzed_at` 的轮询判定。
- 无 active 模型时不派生（帖子 `analyzed_at` 留空）；可另起一张「分析图纸」（手动/定时）做补扫。
- analyze 任务的环节即检视器现有 6 节点（`resolve → fetch → context → ai_call → normalize → persist`），其 `ai_call` 走 AI lane（见 §四 scope）+ 现有多 Key 故障转移（`withKeyFailover`）。

---

## 四、全局出站请求闸（Request Gate）

### 为什么需要

现状 `TokenBucketQueue` 是**进程内**的（[queue.ts](../packages/crawler/src/queue.ts)）：worker 横向扩到 N 个，就有 N 个独立桶，全局出站速率失控——这与「降低封控」直接矛盾。要全局可控，必须有**单一收口点**。同时用户要求该队列在 Web **可视化 + 手动暂停/恢复 + 看执行计划**，这要求请求是**可枚举的记录**而非纯内存令牌。

### 模型：请求即队列行，任务 enqueue 后 park、结果回填后重认领

所有外站请求**不再由任务直接发起**，而是写一条 `request_queue` 行然后「停在 fetch 环节」（检查点 paused），由请求闸放行执行、结果回填到行、唤醒owner 任务续跑——**与检视器「跑一步落库置 paused、续跑靠重认领」完全同构**。

```
Task.fetch_* 环节                请求闸调度器(单实例)                Worker(执行器)
   │ enqueue request_queue 行     │                                  │
   │ 任务置 paused（等结果）       │                                  │
   │                              │ 按 lane 限速 + 暂停开关，取下一条  │
   │                              ├─ 放行（WS push / 标记 released）─▶│ 真正发 HTTP（持 UA/cookie/代理）
   │                              │◀──────── 回填 result/raw ─────────┤
   │◀── owner 任务 paused→queued ─┤ 写 request_queue.done            │
   │ 重认领，消费 result，         │                                  │
   │ 若有下一页→再 enqueue；否则→persist                              │
```

**翻页嗅探的天然落点**：评论/列表翻页 = `fetch_*` 环节「enqueue 一页 → park → 拿结果 → 发现 more/cursor → enqueue 下一页」的循环，每页一条队列行。于是**翻页过程在请求队列里逐行可见**，限速器对每一页都生效。

> 慢成本可接受：我们本就为防封控**刻意慢发**（请求间隔以秒计），相比之下每页一次 PG 重认领的毫秒级开销可忽略，换来的是「每个外站请求都全局可见、可暂停、可编排」。

### 调度器归属与执行

- **调度权（决定什么时候放行哪条）在单实例**——复用 api（已是单实例控制面：cron、WS 网关）。它持有 `request_queue` 的放行节奏：per-lane 令牌桶 + 全局/分 lane 暂停开关 + 优先级 + `scheduled_at`（退避/重试用）。`TokenBucketQueue` 的算法从「每 worker 一个」上移为「单实例每 lane 一个」。
- **执行权（真正发 HTTP）仍在 worker**（数据面持连接器/代理/cookie，api 保持薄）。api 经现有 WS 网关把「已放行的请求」推给空闲 worker（与现状 dispatch job 同一通道），worker 发请求、回填原始结果。
- **lane（按目标分桶）**：`reddit` / `hackernews` / `rss` / `ai-*`。各 lane 独立限速与暂停——Reddit 慢不拖累 AI，反之亦然。

### Scope：请求闸主治外站抓取；AI 请求另算

「降低封控」是**抓取**侧诉求。`claude_cli` 不是 HTTP（经 SDK 起子进程，只能在 worker 本机）；API-Key 类 AI（anthropic/openai/deepseek/azure）是发往厂商的 HTTP、**无封控风险**，已有 `key-failover` 管限流/计费。故：

- **源站 lane（reddit/hn/rss）**：强约束，全部经请求闸排队限速——这是封控防线。
- **AI lane**：逻辑上也登记进同一控制台（统一运维视图 + 可暂停），但其「限速」本质是厂商配额 + Key 池故障转移，`claude_cli` 仅记录占位、实际在 worker 本机执行。

> **开放点（§十二 Q1）**：AI 是否也强制走请求闸的排队，还是仅在控制台「展示 + 可暂停」、放行逻辑沿用 `key-failover`。倾向后者。

### Web 控制台（执行计划 + 暂停/恢复）

- 按 lane 分组列出 `pending/running/recent` 请求行；展示每 lane 速率、队列深度、预计排空时间（ETA）。
- **全局暂停 / 分 lane 暂停**（写 `request_lanes.paused`）；手动调速率、重排优先级、取消单条。
- 实时：首版轮询（复用 `/queue` 的 react-query `refetchInterval`），后续可升 WS。

---

## 五、数据模型（greenfield）

> 清库重建，无增量迁移。下列为新增/重构；`comments`/`insights`/`translations`/`triage`/`sources`/`source_connectors`/`model_providers`/`provider_api_keys`/账户与 RBAC 系列**保留不动**。**废弃** `analysis_jobs`、`job_steps`（由 `tasks`/`task_stages` 取代）。部分唯一索引/CHECK 仍 Prisma 表达不了，由迁移手工维护。

```prisma
/// 图纸：一类可复用、可调度的流程定义。
model blueprints {
  id            Int       @id @default(autoincrement())
  /// 流程类型：collect=采集 / recheck=复查 / maintenance=归档清理（analyze 由事件派生，一般不建独立图纸；如需补扫可建 analyze 类）。
  kind          String
  label         String
  enabled       Boolean   @default(true)
  /// 触发方式：once=单次 / cron=定时 / interval=间隔。
  trigger_kind  String
  /// 触发配置(JSON)：cron 表达式 | interval 的 sweep 行为 | batch_size/batch_interval。
  trigger_config Json?
  /// 业务参数(JSON)：采集=来源筛选/sorts/limit/翻页停止 K/评论预算；复查=batch_size/batch_interval/backoff_cap。
  params        Json?
  created_at    BigInt
  updated_at    BigInt
}

/// 进程：图纸的一次执行实例。
model runs {
  id            Int       @id @default(autoincrement())
  blueprint_id  Int
  /// 冗余 kind，免联表。
  kind          String
  /// running | paused | completed | failed | canceled。
  status        String    @default("running")
  /// 触发来源：manual | cron | interval。
  trigger_source String
  /// 复查 sweep 序号（间隔模式自增，驱动退避到期判定）；非复查为空。
  sweep_seq     Int?
  /// 计数快照。
  tasks_total   Int       @default(0)
  tasks_done    Int       @default(0)
  tasks_skipped Int       @default(0)
  tasks_failed  Int       @default(0)
  params        Json?
  error         String?
  started_at    BigInt
  finished_at   BigInt?

  @@index([blueprint_id, started_at], map: "idx_runs_blueprint")
  @@index([status], map: "idx_runs_status")
}

/// 任务：一个工作单元（绝大多数 = 一条帖子）。取代旧 analysis_jobs，泛化到所有 kind。
model tasks {
  id            Int       @id @default(autoincrement())
  run_id        Int
  /// discover | collect | recheck | analyze | translate。
  kind          String
  /// 血缘：派生它的父任务（discover→collect→analyze），供树形展示与级联。根任务为空。
  parent_task_id Int?
  /// 目标帖子 id（posts.id 软引用）；discover 任务为空。
  post_id       String?
  /// queued | running | paused | succeeded | skipped | failed | canceled。
  status        String    @default("queued")
  attempts      Int       @default(0)
  max_attempts  Int       @default(3)
  /// 当前/下一个待执行环节 seq。
  current_seq   Int       @default(0)
  /// 调度优先级，越小越先。
  priority      Int       @default(0)
  /// 任务级参数 + 分析所需的 provider/model 快照等(JSON)。
  params        Json?
  error         String?
  enqueued_at   BigInt
  started_at    BigInt?
  finished_at   BigInt?
  /// 僵死回收用心跳（running 时刷新；paused 不回收）。
  heartbeat_at  BigInt?

  @@index([run_id], map: "idx_tasks_run")
  @@index([status, priority, enqueued_at], map: "idx_tasks_claim")
  @@index([parent_task_id], map: "idx_tasks_parent")
  // 部分唯一索引（迁移维护）：UNIQUE(post_id, kind) WHERE status IN (queued,running,paused)
  //   —— 同帖同 kind 至多一条活跃任务（去重第③层；泛化自旧 uniq_jobs_active_post）。
}

/// 环节：任务内的有名步骤，逐步落检查点。取代旧 job_steps，泛化到所有 kind。
model task_stages {
  id            Int       @id @default(autoincrement())
  task_id       Int
  seq           Int
  /// 环节名（按 kind 的模板，应用层常量约束，不建 enum 便于演进）。
  name          String
  /// pending | running | done | failed | skipped。
  status        String    @default("pending")
  /// 闸门：true 则本环节跑完即置 paused 等人工放行（逐环节停起的载体；泛化自旧 step_gate 的全局开关）。
  gate          Boolean   @default(false)
  input_summary Json?
  /// 产物 = 展示内容 + 下游/重认领的检查点输入（尤其 ai_call 原始响应、context 文本不可重算）。
  output        Json?
  error         String?
  started_at    BigInt?
  finished_at   BigInt?

  @@unique([task_id, seq], map: "uniq_task_stages_task_seq")
  @@index([task_id], map: "idx_task_stages_task")
}

/// 出站请求队列：所有外站请求的唯一收口，请求闸据此限速/放行/展示。
model request_queue {
  id            Int       @id @default(autoincrement())
  /// 限速分组：reddit | hackernews | rss | ai-<provider>。
  lane          String
  /// 更细的限速键（可选，如具体 host）。
  host          String?
  method        String    @default("GET")
  url           String
  /// 请求载荷/头(JSON)。
  params        Json?
  /// 用途：listing | post_detail | comments_page | ai_call …（展示 + 排查）。
  purpose       String
  /// 等待此请求结果的任务/环节（回填后唤醒）。
  owner_task_id  Int?
  owner_stage_id Int?
  priority      Int       @default(0)
  /// pending | running | done | failed | canceled。
  status        String    @default("pending")
  /// 最早可执行时刻（退避/重试推迟用）。
  scheduled_at  BigInt
  attempts      Int       @default(0)
  /// 抓回的原始结果（交还 owner 任务解析）。
  result        Json?
  error         String?
  enqueued_at   BigInt
  started_at    BigInt?
  finished_at   BigInt?

  @@index([lane, status, priority, scheduled_at], map: "idx_reqq_dispatch")
  @@index([owner_task_id], map: "idx_reqq_owner")
}

/// 请求 lane 的限速与暂停配置（Web 可改；持久化以跨进程/重启）。
model request_lanes {
  lane            String  @id
  rate_per_minute Int     @default(90)
  burst           Int     @default(10)
  max_concurrency Int     @default(1)
  /// 手动暂停开关（请求闸读此决定是否放行该 lane）。
  paused          Boolean @default(false)
  updated_at      BigInt
}
```

**`posts` 增量列（复查记账）**：

```prisma
model posts {
  // …现有列不变；num_comments 复用为「源计数基线」…
  /// 连续未变次数（驱动指数退避）；命中变化即归零。
  recheck_misses    Int     @default(0)
  /// 下次有资格被复查的 sweep 序号；sweep S 的到期集合 = recheck_due_sweep ≤ S。
  recheck_due_sweep Int     @default(0)
  /// 最近一次复查时间（epoch 秒）。
  last_rechecked_at BigInt?
}
```

> ⚠️ 沿用 CLAUDE.md 铁律：改 schema/枚举后必须 `db:migrate:dev` 并**重启所有长驻进程**（api + 全部 worker），否则进程内存里是旧 client。

---

## 六、执行流程

### 采集 run（定时触发一次）

```
调度器              api(控制面)            PG                       Worker
  │ cron 命中         │                      │                        │
  ├──────────────────▶│ 建 run + discover 任务 │                       │
  │                   ├─────────────────────▶│ insert run/tasks       │
  │                   │  discover.fetch_listing：enqueue 列表请求行 ───▶│ (请求闸放行)发 HTTP
  │                   │◀── 回填列表结果 ───────│◀───────────────────────┤
  │                   │  dedup：反连接 posts∪活跃任务                    │
  │                   │  spawn：为每条新帖建 collect 任务（撞唯一索引者跳过）│
  │                   │  collect.fetch_detail/fetch_comments：逐请求入闸（翻页）│
  │                   │  collect.persist：upsert post + replaceComments + 刷新 num_comments │
  │                   │  → 有 active 模型则派生 analyze 子任务            │
  │                   │  analyze.* ：resolve→…→ai_call(AI lane)→…→persist saveInsight │
  │                   │  全部任务终态 → run completed                    │
```

### 复查 sweep（间隔模式）

```
间隔调度器：上一 sweep-run 完成 + batch_interval → 开下一 sweep-run（sweep_seq++）
  选取到期帖（recheck_due_sweep ≤ sweep_seq）→ 建 recheck 任务，按 batch_size 分批
  每帖：probe（1 请求取源计数）→ 比 posts.num_comments
        未变 → recheck_misses++、recheck_due_sweep += min(2^(misses-1),CAP)、任务 skipped
        有变 → recrawl（翻页入闸）→ persist（整删整插 + 刷新基线 + comments_changed_at）→ 派生 analyze
  队列排空 = 本 sweep 完成 → 计数入 run → 调度器隔 batch_interval 开下一 sweep
```

### 逐环节停起（任意任务）

复用检视器机制：某环节 `gate=true` → worker 跑完该环节落检查点、把任务置 `paused`、正常结束（不占槽）。Web 点「继续」→ `paused→queued` + 重新派发 → 重认领从下一环节续跑。「运行到底」= 清掉后续 gate 再放行。`resume` 把 `attempts` 归零（沿用检视器避免逐环节重认领误触僵死回收的处理）。

---

## 七、Web 表现（流程图 + 树形图）

用户诉求：清晰看出「程序图纸 + 进度的样貌」，并能对某些环节做停起按钮。

- **图纸视图（流程图）**：用 react-flow 渲染该 kind 的环节模板为节点图（已落地的「流程图改用 react-flow」即此方向，见近期 commit）。节点 = 环节，连线 = 顺序；节点上挂 **gate 开关**（停/起）与默认配置。这是「图纸长什么样」。
- **进程/进度视图（树形图）**：`run → discover → collect[] → analyze`（及 recheck）的**任务树**，每个任务展开为其环节状态（pending/running ⏳/done ✅/failed ✗/paused ⏸）。这是「跑到哪了」。树节点点开 = 该环节产物面板（复用检视器的节点面板：完整 prompt、AI 原始响应、抓取摘要等）。
- **逐环节控制**：树里任一 `pending` 环节可临时挂/摘 gate；`paused` 任务有「继续 / 运行到底 / 重试本环节 / 取消」（即检视器控制条，推广到所有任务）。
- **请求队列控制台**（§四）：lane 分组的执行计划 + 速率/深度/ETA + 全局/分 lane 暂停恢复 + 重排/取消。
- 复用：检视器现有流程图/节点面板/控制条组件、react-query 轮询、`PageHeader`、`RequirePerm`。

---

## 八、与现状的映射

### 废弃 / 取代

| 现状                                                                                                              | 去向                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SchedulerService` 4 个 `@Cron`（scan/comments/analyze）+ `guard` + `runInitialRound`                             | 删；改为通用 **BlueprintScheduler**：从 `blueprints` 读触发配置开 `run`（cron 类墙钟触发、interval 类完成后续开、once 类仅 API 触发）。单例非重入语义保留 |
| `archive()` cron                                                                                                  | 收为 maintenance 图纸（定时），或保留为唯一轻量内部 cron（二选一，§十二 Q4）                                                                              |
| `TokenBucketQueue`（进程内、每 worker 一个）                                                                      | 算法上移为请求闸**单实例**的 per-lane 限速；新增全局/分 lane 暂停 + 持久化执行计划                                                                        |
| `analysis_jobs` / `job_steps`                                                                                     | `tasks` / `task_stages`（泛化 kind + 血缘 + 任意环节闸门）                                                                                                |
| `getPostsToAnalyze` / `PENDING_ANALYSIS_PREDICATE` / `getPostsNeedingCommentRefresh` / `enqueueAutoAnalysisRound` | 删；分析改由采集/复查**事件派生**；复查到期判定改由 `recheck_due_sweep`                                                                                   |
| 「普通分析 vs 检视模式」二分（`inspect`/`step_gate` 两布尔）                                                      | 合一：所有任务皆环节执行 + 检查点；`gate` 下放到 `task_stages` 逐行                                                                                       |

### 复用（关键，改动面可控）

| 复用                                                                                                                                                             | 说明                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 检视器执行内核（`runInspectJob`/`execNode`/`paused`/`resume`/重认领）                                                                                            | 泛化为通用任务环节执行器；analyze 任务的 6 节点原样                     |
| WS 网关 + `Dispatcher` 协议（[gateway](../apps/api/src/domain/gateway/gateway.service.ts)、[worker-agent](../apps/worker/src/worker-agent.ts)、kernel protocol） | 任务派发沿用；新增「放行请求」复用同一推送通道                          |
| `claimNextJob` 的 `FOR UPDATE SKIP LOCKED` + 心跳 + 僵死回收                                                                                                     | 泛化为 `claimNextTask`；请求闸放行的请求亦可同法被 worker 认领          |
| 多 Key 故障转移 `withKeyFailover`（[key-failover](../packages/analysis/src/key-failover.ts)）                                                                    | analyze 任务 ai_call 沿用                                               |
| `replaceComments`（整删整插）、`saveInsight`（按 post_id 幂等 upsert）、连接器/抓取解析（reddit/hn/rss）                                                         | 原样；fetch 改为「请求闸放行后执行」                                    |
| 编排集中在 service、controller 薄（检视器 §实现偏差 3）                                                                                                          | 新编排集中在（新的）`PipelineService`/`RequestGateService`，HTTP 端点薄 |

### 改造范围（概览）

- **新增**：`blueprints`/`runs`/`request_queue`/`request_lanes` 表 + 仓储；`BlueprintScheduler`；`RequestGateService`（单实例放行器）；Web 图纸/进度/请求队列三视图。
- **重构**：`analysis_jobs→tasks`、`job_steps→task_stages`（含仓储 `JobsRepository→TasksRepository` 等）；worker 执行器泛化；crawler 抓取改走请求闸；`SchedulerService` 退役。
- **不变**：账户/RBAC、洞察/筛选/导出读侧、translations、连接器抓取与解析逻辑本体。

---

## 九、权限

新增能力 key（目录在 `@hatch-radar/shared`，见 RBAC 设计）：

- `pipeline:run`——启停图纸 / 发起 run / 单次触发。
- `pipeline:control`——逐环节停起、重试、取消任务。
- `requests:control`——请求队列暂停/恢复/调速/重排。

读视图（看图纸与进度）可挂较低门槛或复用现有只读能力；超管隐式全通。

---

## 十、故障与边界

| 场景                         | 处理                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 多 worker 并发抢请求/任务    | 仍 `FOR UPDATE SKIP LOCKED`；请求闸单实例只决定**放行节奏**，执行可并发但受 lane `max_concurrency` 约束                                                                            |
| 请求 429/网络失败            | `request_queue.attempts++` + `scheduled_at` 退避重排；连续失败超阈 → failed，唤醒 owner 任务按其 `max_attempts` 处理；可触发该 lane 全局退避（沿用 `TokenBucketQueue.pause` 思路） |
| owner 任务在 park 期间被回收 | 任务 paused 不回收；仅 running（环节执行中）受僵死回收，回 queued 后从同一 pending 环节重跑（检查点不丢）                                                                          |
| `paused` 任务永驻            | 低频；保底：超 N 小时自动 canceled（沿用检视器保底项）                                                                                                                             |
| 采集与复查/重复 run 抢同帖   | 三层去重（§3.1）；活跃唯一索引兜底并发                                                                                                                                             |
| 源计数缓存/抖动致误判        | 偶发 false-positive 只多一次 recrawl（被 `replaceComments` 真相化），可接受；退避对长期沉默帖仍有效                                                                                |
| 环节产物体积                 | context 文本/AI 原始响应几 KB jsonb 无压力；高频 collect 任务的环节随老 run 归档清理（maintenance 图纸按 run.finished_at 清 `runs/tasks/task_stages/request_queue`）               |
| 配置热重载                   | run 启动时把图纸 `params` 快照进 `runs.params`；进行中的 run 用快照，改图纸只影响下一 run                                                                                          |

---

## 十一、分期落地建议

1. **M0 schema 重建**：greenfield 迁移（新表 + posts 记账列 + 部分唯一索引；删旧表）；仓储重构 `tasks`/`task_stages`。重启全进程冒烟。
2. **M1 执行内核泛化**：把检视器 `runInspectJob` 泛化为通用任务环节执行器（按 kind 取环节模板 + `task_stages.gate` 逐行闸门）；analyze 任务回归绿。
3. **M2 请求闸**：`request_queue`/`request_lanes` + `RequestGateService`（单实例放行 + per-lane 限速 + 暂停）+ worker 执行器走「请求闸放行」；翻页嗅探改为逐页入闸。
4. **M3 图纸与调度**：`blueprints`/`runs` + `BlueprintScheduler`（once/cron/interval）；采集图纸（discover 三层去重 + 停止规则）；采集→analyze 事件派生。
5. **M4 复查图纸**：probe/基线对比（`num_comments`）+ recrawl + 指数退避（`recheck_due_sweep`）+ 间隔 sweep 循环 + 变化→重新分析。
6. **M5 Web 表现**：react-flow 图纸视图 + 任务树进度视图 + 逐环节停起 + 请求队列控制台。
7. **M6 打磨**：maintenance 归档图纸、paused 保底清理、权限收口、演示态视觉。

每阶段照例 `pnpm typecheck` + `pnpm lint` + `pnpm test`（测试需 `docker compose up -d db`）。

---

## 十二、开放问题

1. **AI 请求是否强制走请求闸排队**，还是仅在控制台「展示 + 可暂停」、放行沿用 `key-failover`？（倾向后者——AI 无封控风险）
2. **图纸是「固定环节模板 + 配置 + 可视化」**（本设计 v1 范围），还是要做**用户可视化自由编排环节的流程编辑器**（大得多，建议 v2）？
3. **请求闸执行权放置**：api 经 WS 推给 worker 执行（本设计推荐，保持 api 薄）；还是单独起一个「fetcher」单实例进程；或 api 直接执行抓取（违背 api/worker 分面）？
4. **归档**：收为 maintenance 图纸（定时），还是保留唯一一个轻量内部 cron？
5. **退避 `CAP`** 取值（如 16）与复查 `batch_size`/`batch_interval` 默认值。
6. **discover 翻页停止规则的 K**（连续命中已知帖数）与采集是否需要「深翻历史」的一次性回填模式。
