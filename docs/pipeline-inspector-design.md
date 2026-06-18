# 流水线检视器（Pipeline Inspector）设计

> 单条手动触发、逐节点暂停的交互式分析流水线。让「一条原始数据如何变成洞察」的全过程可见、可控、可演示。

> **实现状态（2026-06-18）**：M1–M3 已落地。后端（迁移 / `job_steps` 仓储 / `callRaw` 拆分 / worker `runInspectJob` / `/api/analysis/inspect/*` 端点）全量 typecheck + lint + 测试通过（含 11 个检视专项用例，覆盖逐节点暂停—放行—续跑—落库、运行到底、节点失败重试、取消、paused 不被认领/回收）。前端检视页（流程图 + 节点面板 + 控制条）+ 帖子详情入口 + 队列「检视」跳转已落地、typecheck + 构建通过。落地中的关键偏差见文末「实现偏差」。**待验**：真起 AI 模型的浏览器端到端走查（需配置可用模型 + 登录态）。

## 一、背景与目标

### 痛点

正常分析流水线是「定时调度 → 批量入队 → worker 并发认领 → AI 写回」，跑得很快且全程后台异步。结果是：**一条原始帖子如何一步步变成最终洞察报告，中间过程完全不可见**。看板（`/queue`）只能看到 job 从 `queued` 跳到 `succeeded`，看不到中间的 Prompt、AI 原始响应、解析过程。

这带来三类困扰：

1. **看不清**：开发/调试时无法定位「洞察质量差」到底坏在哪一环（上下文构建？Prompt？模型？解析？）。
2. **难验证**：换模型、调 Prompt 后，想对单条做 A/B 对比验证，没有抓手。
3. **没法演示**：想给别人讲清楚「我们的 AI 管线在做什么」，没有可视化的载体。

### 目标

做一个**交互式流水线检视器**：

- **单条手动触发**：选一条帖子，点一下，只跑这一条。
- **逐节点暂停**：流水线显式拆成若干节点，每个节点跑完后**停在闸门**，等管理员点「继续」才进入下一节点。
- **全过程可视化**：横向管道线路图直观展示当前任务跑在哪个节点；下方大面板展示当前节点的完整产物（完整 Prompt 文本、AI 原始响应、结构化结果等）。
- **可演示**：逐步放行的节奏天然适合现场讲解。
- **可跑到底**：中途可一键「运行到底」，连续跑完剩余节点但保留完整轨迹供回看。

### 定性：这不是纯调试功能

它在运营期同样有价值——验证 AI 输出质量、重跑漏掉的帖子、测试换模型/Prompt 后的效果差异。因此做成 web 控制台的**正式功能**（PC 端，演示与调试都是 PC 场景；移动端不涉及）。

---

## 二、先把「流水线」拆成显式节点

检视器的前提，是把目前**封装在一次 `processor.analyze()` 调用里的黑盒**，显式拆成有名字、有产物、可逐个检视的节点。

对照现有代码（`apps/worker/src/worker.service.ts` 的 `runAnalysisJob` → `AnalysisService.analyzeAndPersist` → `PostProcessor.analyze` → `analyzer/*.ts`），真实流水线是 6 个节点：

| seq | 节点                        | 现有代码位置                                                                                                 | 输入            | 产物（落库 + 展示）                                                          | 可否重算        |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------- | --------------- |
| 0   | **resolve**（解析模型）     | `AnalysisConfigService.getProcessorForProvider` + `listUsableKeys`                                           | `provider_id`   | provider 标签 / 模型名 / provider_kind / 可用 Key 数                         | ✅ 幂等         |
| 1   | **fetch**（拉取原始数据）   | `PostsRepository.getPostById` + `CommentsRepository.getCommentsForPost`                                      | `post_id`       | 帖子标题 / 正文字符数 / 评论总数 / 楼层树规模                                | ✅ 幂等         |
| 2   | **context**（构建上下文）   | `analyzer/context.ts` 的 `buildContext`                                                                      | post + comments | **完整 context 文本** + `SYSTEM_PROMPT` + 字符/估算 token                    | ✅ 纯函数       |
| 3   | **ai_call**（调用 AI）      | `analyzeWithAnthropic` / `analyzeWithOpenAICompatible` / `analyzeWithClaudeAgent` 中「发请求拿原始输出」那段 | context 文本    | **AI 原始响应**（JSON 文本 / structured_output）+ token usage + 实际用的 Key | ❌ **不可重算** |
| 4   | **normalize**（解析归一化） | `analyzer/prompt.ts` 的 `normalizeInsight`                                                                   | AI 原始响应     | 结构化 `InsightResult`（痛点 / 机会 / 标签）+ 「丢弃了哪些非法条目」         | ✅ 纯函数       |
| 5   | **persist**（落库）         | `AnalysisService.analyzeAndPersist` 落库段 + `markAnalyzed` + `succeedJob`                                   | normalize 结果  | 是否有信号 / 落库的 insight id                                               | ⚠️ 需幂等       |

**关键观察**：6 个节点里只有 `ai_call` 是「耗时、花钱、且结果不确定」的——其余要么是毫秒级纯函数（context / normalize），要么是幂等的 DB 读取（fetch / resolve）。这条观察决定了下面整个架构。

---

## 三、核心设计决策

### 决策 1：Worker 不阻塞——用「检查点 + 重认领」实现暂停

**约束**：worker 是无状态的数据面进程，被 gateway 经 WS `dispatch` 推送任务后**一口气跑完**（`worker-agent.ts:118` `executeJob`）。它不能、也不应该「卡在某个节点上 sleep 等管理员点击」——那会一直占着并发槽位、占着 AI 连接、还要处理超时与进程重启。

**方案**：不让 worker 等待，而是**让它每跑完一个节点就把产物落库、把任务状态置为 `paused` 后正常结束**。管理员点「继续」时，由控制面把任务重新放回队列，worker **重新认领、从下一个节点接着跑**。

```
            ┌──────────── 一次 dispatch 只推进一个节点 ────────────┐
            ▼                                                      │
  [认领 running] → 跑节点 k → 落库 step[k].output → 置 paused → 结束(发 job_result)
                                                       │
                                                  管理员点「继续」
                                                       │
                                            paused → queued → gateway 重新 dispatch
                                                       │
                                                       └──────────► 认领，跑节点 k+1 …
```

这正是用户提出的思路，且经验证**与现有 push 架构天然契合**（见决策 2）。

### 决策 2：复用现有状态机与网关，改动面降到最小

核查现有代码后确认，「检查点 + 重认领」几乎不需要动通信层：

- `worker-agent.ts` 的 `executeJob`：`executeDispatchedJob` **正常返回**就发 `job_result{status:'succeeded'}`（无论内部跑了几个节点）。
- `gateway.service.ts` 收到 `job_result`：只做 `activeJobs-- + tryDispatch()`，**绝不写 DB**（DB 状态由 worker 自己写）。
- `jobs.repository.ts` 的 `claimNextJob`：`WHERE status = 'queued'`——**只认领 queued**。

于是：worker 跑完一个节点后把 job 置成新状态 **`paused`**，然后正常返回。worker-agent 照常发 `job_result` → gateway 释放槽位并尝试派发下一个，但因为这条 job 现在是 `paused` 而非 `queued`，**不会被再次认领**，自然静静停在闸门。管理员点「继续」→ 控制面把它 `paused → queued` 并 `tryDispatch()` → 被重新认领 → 跑下一节点。

> **结论：`packages/kernel/src/protocol.ts`、`gateway.service.ts`、`worker-agent.ts` 三处零改动。** `job_result{succeeded}` 对「单步成功」语义同样成立。

需要的状态机增量：

- `job_status` 枚举新增 **`paused`**（节点间闸门态）。
- `analysis_jobs` 新增两个布尔开关（见决策 3 与数据模型）。
- 僵死回收（`reclaimRunningJobs`）只扫 `status='running'`，**不碰 `paused`**——暂停中的任务不会被误回收（节点执行中短暂为 `running` 且有心跳，正常）。

### 决策 3：中间产物必须持久化——`ai_call` 不可重算是根因

重认领后从「下一个节点」继续，前提是**能拿到上游节点的产物**。这里区分两类：

- **幂等可重算的上游**（post、comments、processor）：当前节点需要时**直接重新拉取/重新解析**，不依赖持久化（廉价且幂等）。
- **不可/不宜重算的上游**（context 文本、**AI 原始响应**、normalize 结果）：**写入 `job_steps.output` 作为检查点**，下游从检查点读取。

其中 **`ai_call` 的原始响应是整个设计必须持久化的根本理由**：它花钱、结果不确定、claude_cli 还会起子进程。绝不能因为「重认领跑 normalize」而把 AI 重调一遍。所以 `ai_call` 跑完即把原始响应存进 `job_steps`，`normalize` 节点从那里读。

每个节点重认领时的输入来源，一张表说清：

| 节点      | 输入从哪来                                                             |
| --------- | ---------------------------------------------------------------------- |
| resolve   | job 自带 `provider_id` → 重新解析（幂等）                              |
| fetch     | job 自带 `post_id` → 重新拉（幂等）                                    |
| context   | 重新拉 post+comments（幂等）→ `buildContext`；产物存 output            |
| ai_call   | 读 `step[context].output` 的 context 文本 + 重新解析 processor → 调 AI |
| normalize | 读 `step[ai_call].output` 的原始响应 → `normalizeInsight`              |
| persist   | 读 `step[normalize].output` 的结构化结果 + 重新拉 post → `saveInsight` |

> context 文本选择「存 output」而非「每次重算」，除省一次构建外，更是为了**避免两次认领之间 crawler 的 `replaceComments` 改写评论、导致发给 AI 的上下文与展示给管理员的上下文漂移**。检查点即「所见即所跑」。

### 决策 4：把 provider 的 `callRaw` 与 `normalize` 拆开

当前三个 provider 的 `analyze()` 都是「调 AI + 归一化」一体（如 `anthropic.ts:59` 直接 `normalizeInsight(JSON.parse(textBlock.text))`）。检视器要把 `ai_call` 和 `normalize` 拆成两个可独立执行、各自留痕的节点，因此需要把「调 AI 拿原始输出」从「归一化」中解耦。

设计为给 `PostProcessor` 增加一个分步能力（normal 路径不受影响）：

```ts
interface PostProcessor {
  readonly label: string;
  readonly model: string;
  analyze(post, comments, signal?): Promise<AnalysisOutcome>; // 现状：一体（normal 模式继续用）
  /** 分步：只调模型拿原始输出，不归一化（检视器 ai_call 节点用） */
  callRaw(context: string, signal?): Promise<RawModelOutput>; // 新增
}

interface RawModelOutput {
  /** 模型原始输出：anthropic/openai 为 JSON 文本；claude_cli 为 structured_output 对象 */
  raw: string | object;
  usage: TokenUsage | null;
}
```

顺带可把现有 `analyze()` 重构成 `callRaw + normalizeInsight` 的组合，**消除重复**（normal 与 stepwise 共享同一条调用逻辑，杜绝行为分叉）。

- **多 Key 故障转移**：现状 `analyzeWithFailover`（`analysis-config.service.ts:129`）包裹的是 `underlying.analyze`。改为也能包裹 `callRaw`（抽出 `callRawWithFailover`），让检视器的 `ai_call` 走与生产**完全一致**的 Key 池逻辑；产物里附带「实际用了哪把 Key / 是否发生过切换」。
- **claude_cli 特例**：其 `raw` 是 `structured_output`（已是结构化对象）。`ai_call` 节点原样展示模型结构化输出，`normalize` 节点展示 `normalizeInsight` 后的结果——两步对比能看出归一化丢弃/修正了什么，仍有展示价值。

---

## 四、数据模型

### `analysis_jobs` 增量

```prisma
model analysis_jobs {
  // ……现有字段不变……

  /// 检视模式：true 则按节点拆解执行并把每步产物写入 job_steps（normal 任务为 false，零额外开销）。
  inspect    Boolean @default(false)
  /// 逐节点闸门：true 则每个节点跑完后置 paused 等人工放行；false 则一口气跑完（但仍留轨迹）。
  step_gate  Boolean @default(false)
}

enum job_status {
  queued
  running
  succeeded
  failed
  canceled
  paused      // 新增：节点间闸门，等待人工放行；claimNextJob 不认领，reclaim 不回收
}
```

两个布尔的组合覆盖三种运行形态（不动 `trigger`，它仍表来源 auto/manual）：

| 形态             | inspect | step_gate | 行为                                       |
| ---------------- | ------- | --------- | ------------------------------------------ |
| 普通分析（现状） | false   | false     | 一次认领跑完，**不写 job_steps**，零开销   |
| 运行到底＋留痕   | true    | false     | 一次认领连续跑完所有节点，每步写 job_steps |
| **逐步检视**     | true    | true      | 每节点一停，写 job_steps，置 paused 等放行 |

中途点「运行到底」= 把 `step_gate` 置 false 再放行，worker 接管后连续跑完。

### 新表 `job_steps`

```prisma
/// 检视模式下分析任务的逐节点轨迹与产物（检查点）。job_type=analysis、inspect=true 的任务才有行。
model job_steps {
  id            Int       @id @default(autoincrement())
  /// 所属任务（analysis_jobs.id），软引用；随 job 清理时一并删除。
  job_id        Int
  /// 节点序号 0..N，决定执行与展示顺序。
  seq           Int
  /// 节点名：resolve | fetch | context | ai_call | normalize | persist（应用层常量约束，不建 enum 便于演进）。
  name          String
  /// 节点状态：pending | running | done | failed | skipped。
  status        String    @default("pending")
  /// 输入摘要（展示用，如 provider 标签、评论数）。
  input_summary Json?
  /// 节点产物：既是展示内容，又是下游节点的检查点输入（见设计决策 3）。
  output        Json?
  /// 失败原因（status=failed 时）。
  error         String?
  started_at    BigInt?
  finished_at   BigInt?

  @@unique([job_id, seq], map: "uniq_job_steps_job_seq")
  @@index([job_id], map: "idx_job_steps_job")
}
```

- 创建检视任务时，一次性插入 6 行 `pending` 节点（`seq` 0..5）。
- `output` 为 `jsonb`：context 文本、AI 原始响应各几 KB，无压力。检视任务低频（调试/演示），且 `job_steps` 随 `deleteFinishedJobsBefore` 归档时一并清理（按 `job_id`）。

> ⚠️ **Prisma 改枚举/建表后必须 `db:migrate:dev` 并重启所有长驻进程**（api + 所有 worker），否则进程内存里是旧 client，会报 `Value 'paused' not found in enum 'job_status'`（见 CLAUDE.md）。

---

## 五、执行流程

### 时序（逐步检视：inspect=true, step_gate=true）

```
管理员            API(控制面)              PG                  Gateway          Worker(数据面)
  │                  │                     │                     │                  │
  │ 单步分析此帖     │                     │                     │                  │
  ├─────────────────►│ 建 job(inspect,gate)│                     │                  │
  │                  ├────────────────────►│ insert job=queued   │                  │
  │                  ├────────────────────►│ insert 6×step=pending│                 │
  │                  ├─ tryDispatch ──────────────────────────►  │ claim queued     │
  │                  │                     │ job→running         ├──dispatch───────►│
  │                  │                     │                     │                  │ 跑 step0 resolve
  │                  │                     │◄── step0.output, status=done ──────────┤
  │                  │                     │◄── job→PAUSED ─────────────────────────┤
  │                  │                     │                     │◄─job_result(ok)──┤ 结束(释放槽位)
  │ 轮询 steps       │                     │                     │                  │
  │◄─ 看到 step0=done, job=paused ─────────│                     │                  │
  │ 点「继续」        │                     │                     │                  │
  ├─────────────────►│ resume(jobId)       │                     │                  │
  │                  ├────────────────────►│ job paused→queued   │                  │
  │                  ├─ tryDispatch ──────────────────────────►  │ claim queued     │
  │                  │                     │ job→running         ├──dispatch───────►│ 读 step0 检查点
  │                  │                     │                     │                  │ 跑 step1 fetch …
  │                  │                     │                     │                  │
  │  …… 重复 6 次，最后 persist 节点完成 ……                                          │
  │                  │                     │◄── job→SUCCEEDED ──────────────────────┤
  │◄─ 全部 done，跳转洞察 ─────────────────│                     │                  │
```

### worker 侧分步执行器（新增 `runInspectJob`，约 120 行）

```
runInspectJob(job):
  steps = jobs.getSteps(job.id)                 // 6 行
  next  = steps.find(s => s.status == 'pending')// 下一个待执行节点
  if !next: return                              // 理论不会发生（兜底）

  loop:
    markStepRunning(next)
    try:
      out = await execNode(next.name, job, steps)  // 见下；输入按§三表从 job/重拉/上游 output 取
      markStepDone(next, out)
    catch e:
      markStepFailed(next, e); jobs.failJob(job.id, e)   // 整条 job → failed
      return
    if next.name == 'persist':                  // 末节点
      jobs.succeedJob(job.id, usage)            // 整条 job → succeeded
      return
    if job.step_gate:                           // 逐步闸门
      jobs.pauseJob(job.id)                     // job → paused，结束本次认领
      return
    next = nextPending()                         // step_gate=false：连续跑下一节点
```

`execNode` 按节点名分派，复用现有函数：`buildContext`（节点 2）、`callRawWithFailover`（节点 3）、`normalizeInsight`（节点 4）、`AnalysisService` 落库段（节点 5）。AI 调用仍受 `jobTimeoutMs` 超时与 `AbortSignal` 约束（沿用现有 `withTimeout`）。

`runJob` 入口按 `job.inspect` 分流：`inspect ? runInspectJob : runAnalysisJob`（现有 normal 路径一字不动）。

---

## 六、API 设计

挂在现有 `AnalysisController`（`/api/analysis/*`，`SessionAuthGuard` + `@RequirePermission('analyze:run')`）下，沿用既有风格：

| 方法   | 路径                                      | 作用                                                                                                                                  |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/analysis/inspect`                   | 建检视任务。body `{ postId, providerId, stepGate?=true }`。建 job(inspect=true) + 6 个 pending step + `tryDispatch`。返回 `{ jobId }` |
| `GET`  | `/api/analysis/inspect/:jobId`            | 取任务 + 全部节点（含 output）。前端轮询此端点                                                                                        |
| `POST` | `/api/analysis/inspect/:jobId/resume`     | 放行下一节点：`paused → queued` + `tryDispatch`（仅 paused 可放行）                                                                   |
| `POST` | `/api/analysis/inspect/:jobId/run-to-end` | 一键跑完：`step_gate=false` 后若 paused 则放行                                                                                        |
| `POST` | `/api/analysis/inspect/:jobId/retry-step` | 重试当前 failed 节点：该 step 回 pending、job `failed → queued` + dispatch（对 ai_call 限流/网络失败尤其有用）                        |
| `POST` | `/api/analysis/inspect/:jobId/cancel`     | 取消：job → canceled（释放闸门，停止演示）                                                                                            |

- 实时更新首版用**轮询**（复用 `/queue` 的 `react-query refetchInterval` 模式，零新增基建）：默认 3s；当任务 `running`（尤其 ai_call）时降到 1s。SSE/WS 推送列为可选增强。
- 入队幂等：现有 `uniq_jobs_active_post` 保证「同帖至多一条活跃分析任务」。检视任务与普通分析任务共用此约束——若该帖已有活跃分析任务，`/inspect` 应明确报错（而非静默跳过），提示先等其完成。

---

## 七、前端设计

### 入口与路由

- 新路由 `/inspect/:jobId`（检视单条任务），及发起页 `/inspect`。
- 入口按钮散布在数据流各处，都指向同一检视视图：
  - **帖子详情 `/posts/:id`**：「单步分析此帖」
  - **发起分析 `/analyze`**：批量入队旁加「以单步模式分析选中的第一条」
  - **队列 `/queue`**：检视模式的 job 行加「检视」跳转
- 复用 `PageHeader` + `RequirePerm perm="analyze:run"` + 现有 app shell。

### 布局：横向管道线路图 + 当前节点大面板

放弃抽屉（空间不足），用整页。上方是贯穿的节点流程图（一眼看出跑到哪），下方是当前/选中节点的完整产物，底部是控制条。

```
┌────────────────────────────────────────────────────────────────────────┐
│  流水线检视  ·  r/SaaS「Looking for a tool to…」      [运行到底] [取消]   │
├────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ①解析模型 ──▶ ②拉取数据 ──▶ ③构建Prompt ──▶ ④调用AI ──▶ ⑤解析 ──▶ ⑥落库 │
│     ✅ 0.0s      ✅ 0.1s        ✅ 0.0s       ⏳ 运行中…    ⚪        ⚪    │
│                                              ▲ 当前                       │
├────────────────────────────────────────────────────────────────────────┤
│  当前节点：④ 调用 AI                                  Claude (sonnet-4-6) │
│  输入 4,200 tokens · 使用 Key #2（#1 限流已切换）                         │
│                                                                          │
│  ┌─ 发送的完整 Prompt（system + user）──────────────────┐                 │
│  │ [system] 你是一名资深市场研究分析师……                │  ← 节点③产物    │
│  │ [user]   请分析以下社区内容：标题: …… 评论(本地已抓…) │     可折叠回看   │
│  └──────────────────────────────────────────────────────┘                 │
│  ┌─ AI 原始响应 ────────────────────────────────────────┐                 │
│  │ { "pain_points":[ { "description":"…","evidence":… }] │  ← 实时填充     │
│  └──────────────────────────────────────────────────────┘                 │
│                                                                          │
├────────────────────────────────────────────────────────────────────────┤
│                                   [▶ 继续下一步：解析结果]  ←主操作        │
└────────────────────────────────────────────────────────────────────────┘
```

- **节点状态**：`pending` 灰圈 / `running` 高亮脉冲 + 计时 / `done` 绿勾 + 耗时 / `failed` 红叉 + 错误 / `paused` 当前节点用边框/箭头强调。点已完成节点可回看其产物（只读）。
- **逐节点产物展示**（点节点切换面板）：
  - resolve：provider 标签、模型、provider_kind、可用 Key 数。
  - fetch：帖子元信息、正文字符数、评论总数 / 楼层树规模。
  - context：完整 `SYSTEM_PROMPT` + `buildContext` 文本（代码块，可折叠/复制），字符与估算 token。
  - ai_call：实际用的 Key、token usage、**AI 原始响应**（JSON 高亮）。
  - normalize：结构化痛点/机会/标签卡片，并标注「归一化丢弃的非法条目」。
  - persist：是否有信号、落库的 insight，完成后「跳转洞察详情」。
- **控制条**：主按钮「继续下一步：<下一节点名>」（job=paused 时可点）；副操作「运行到底」「重试本节点」（failed 时）「取消」。
- **组件**：`Card` / `Badge` / `Tabs`（节点切换）/ `ScrollArea` + `Collapsible`（长文本）/ `Button` / `Spinner` / `Empty`（错误态）。流程图用轻量自绘（flex + 连接线），无需引第三方。
- **演示友好**：节点大、字大、产物全文可见、节奏由人手控制——天然适合投屏讲解。

---

## 八、故障与边界

| 场景                    | 处理                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **paused 任务永驻**     | 检视任务低频；加保底：`paused` 超 N 小时由清理任务自动 `canceled`（或仅人工取消）。`job_steps` 随 job 归档清理。                                                          |
| **节点执行中崩溃/超时** | 节点执行期 job=running 有心跳，沿用僵死回收：回 `queued` 重排 → 重认领后**从同一个 pending 节点重跑**（前序 done 节点的检查点不丢，AI 不会重调，除非崩在 ai_call 自身）。 |
| **ai_call 崩溃**        | 该节点尚未写 output → 重试会真正重调 AI（符合预期：上次没拿到结果）。                                                                                                     |
| **persist 幂等**        | 重认领可能重跑 persist。须确认 `InsightsRepository.saveInsight` 按 `post_id` 幂等（按现有「按 post_id 幂等落库」约定，应已满足；落地前复核）。                            |
| **空信号**              | normalize 后痛点/机会均空 → persist 不落库（`saved=false`），节点照常 done，展示「无信号，未落库」。                                                                      |
| **配置热重载**          | 两次认领之间管理员改了模型配置 → resolve/ai_call 重新解析时取到新配置。检视场景可接受；产物记录「实际使用的模型快照」以免误读。                                           |
| **僵死回收误伤**        | `reclaimRunningJobs` 仅扫 `running`，`paused` 不在其列，不会被回收。                                                                                                      |
| **重复入队**            | 同帖已有活跃分析任务时 `/inspect` 显式报错，避免与普通分析任务争用 `uniq_jobs_active_post`。                                                                              |

---

## 九、改造范围

### 新增

```
packages/db/prisma/migrations/<ts>_pipeline_inspector/   job_status+paused、analysis_jobs+inspect/step_gate、建 job_steps
packages/db/src/repositories/job-steps.repository.ts     job_steps 读写 + pauseJob/resumeJob 等状态流转
apps/worker/src/...（worker.service.ts 内）              runInspectJob + execNode 分步执行器
apps/web/src/pages/inspect.tsx                           检视页（流程图 + 节点面板 + 控制条）
apps/web/src/components/pipeline/*                        流程图、节点面板等
```

### 修改

| 文件                                                                                | 改动                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/db/prisma/schema.prisma`                                                  | `job_status` 加 `paused`；`analysis_jobs` 加 `inspect`/`step_gate`；新增 `job_steps` |
| `packages/analysis/src/analyzer/{anthropic,openai-compatible,claude-agent}.ts`      | 抽出 `callRaw`，`analyze()` 重构为 `callRaw + normalizeInsight`                      |
| `packages/analysis/src/analyzer/analyze.ts`                                         | `PostProcessor` 加 `callRaw`；`createProcessor` 补齐                                 |
| `packages/analysis/src/analysis-config.service.ts`                                  | 抽 `callRawWithFailover`；新增 `enqueueInspectRun`                                   |
| `apps/worker/src/worker.service.ts`                                                 | `runJob` 按 `inspect` 分流到 `runInspectJob`                                         |
| `apps/api/src/http/analysis.controller.ts`                                          | 新增 `/inspect` 系列端点                                                             |
| `apps/web/src/router.tsx`、`app-sidebar.tsx`、`posts.tsx`/`analyze.tsx`/`queue.tsx` | 路由 + 入口按钮                                                                      |

### 不变（关键复用）

| 组件                                             | 原因                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| `packages/kernel/src/protocol.ts`                | WS 协议不变，`job_result{succeeded}` 复用              |
| `apps/api/src/domain/gateway/gateway.service.ts` | 分发/释放槽位逻辑不变                                  |
| `apps/worker/src/worker-agent.ts`                | 上报逻辑不变                                           |
| `claimNextJob` / 僵死回收                        | `paused` 天然被 `WHERE status='queued'` 排除、不被回收 |
| normal 分析路径（`runAnalysisJob`）              | 一字不动，零回归风险                                   |

---

## 十、权限与关系

- **权限**：复用 `analyze:run`（能跑分析即可单步跑）。如需收紧可后续加 `analyze:inspect`，首版不引入。
- **与 manual run 的关系**：检视任务是 manual run 的「逐步/留痕」变体。auto 调度永远 `inspect=false`，零影响。检视任务也出现在 `/queue` 看板（可加 `inspect` 标识列）。

---

## 十一、分期落地建议

1. **M1 数据与执行内核**：迁移（枚举/表/字段）+ `job_steps` 仓储 + provider `callRaw` 拆分 + worker `runInspectJob`。用脚本/测试驱动验证「逐节点暂停—放行—续跑—落库」闭环（不依赖前端）。
2. **M2 API**：`/inspect` 系列端点 + 入队幂等/错误语义 + 单测。
3. **M3 前端**：检视页（流程图 + 节点面板 + 控制条）+ 各入口 + 轮询。
4. **M4 打磨**：运行到底 / 重试节点 / 取消 / paused 清理 / `/queue` 检视标识 / 演示态视觉。

每阶段照例 `pnpm typecheck` + `pnpm lint` + `pnpm test`（测试需 `docker compose up -d db`）。

---

## 十二、设计取舍备忘

- **为何不做抽屉**：节点产物（完整 Prompt、AI 原始响应）需要整页空间；逐步演示也需要大视图。
- **为何不在 API 端直接分步跑**：AI 调用必须在 worker（claude_cli 只能复用 worker 本机登录态），控制面不 carry AI 逻辑。
- **为何用 paused 重认领、而非 worker 内 sleep 等待**：worker 无状态、要可横向扩、要扛超时与重启；阻塞等待与这些全冲突。检查点重认领把「等待」交给持久层，worker 始终无状态。
- **为何 ai_call 必须落检查点**：唯一不可重算的节点（花钱、不确定、起子进程）——这是 `job_steps` 存在的根本理由，其余节点持久化是为了「所见即所跑」与展示。

---

## 开放问题

1. ~~`saveInsight` 是否已对 `post_id` 完全幂等（persist 节点重跑安全）？~~ **已复核：是。** `InsightsRepository.saveInsight` 以 `upsert({ where: { post_id } })` 实现，重跑只更新不新增、保留 `insights.id`。persist 节点重认领重跑安全。
2. ~~`ai_call` 的多 Key 故障转移：~~ **已采用完整 failover（与生产一致）。** 抽出泛型 `withKeyFailover`，`analyze` 与 `callRaw` 共用同一条 Key 池逻辑；检视产物附带「实际用的 Key id / 是否切换过」（`AiCallOutput.keyId` / `keySwitched`）。
3. 是否需要把同一条帖子「用不同模型各跑一遍」做并排对比（A/B 检视）？可作为 M4+ 增强（未实现）。
4. 实时更新长期是否升级为 SSE/WS（替代轮询）？取决于演示对延迟的要求（首版用轮询：running/queued 1.5s、paused 2.5s、终态停）。

---

## 实现偏差（相对本设计文档）

落地时为求一致性与正确性，有几处与文档原描述不同，均更优：

1. **唯一索引纳入 `paused`**：文档 §六 称沿用现有 `uniq_jobs_active_post`，但该部分唯一索引原谓词只含 `queued/running`。paused 检视任务仍应占该帖「活跃」名额（否则 paused→queued 放行时可能与并行入队的普通任务撞索引）。新增迁移 `inspect_active_post_paused` 把谓词扩为 `IN (queued, running, paused)`；`enqueueJobs` 的 `ON CONFLICT DO NOTHING` 顺带使「正被检视的帖子」不会被自动分析重复入队。
2. **状态流转归属**：文档 §九 把 `pauseJob/resumeJob` 等列在 `job-steps.repository`。实际把所有 `analysis_jobs` 状态写（`createInspectJob` / `pauseJob` / `resumeInspectJob` / `requeueFailedJob` / `disableStepGate` / `isStepGateOn` / `cancelJob` / `getJob`）留在 `JobsRepository`（与既有 `succeedJob/failJob/claimNextJob` 同源、表归属清晰）；`JobStepsRepository` 只管 `job_steps` 行（`listSteps` / `markStepRunning|Done|Failed` / `resetStepToPending`）；创建时「job + 6 节点」在 `JobsRepository.createInspectJob` 内一个事务原子插入。
3. **API 编排集中在 `AnalysisConfigService`**：`/inspect/*` 端点很薄，编排（建任务 / 组装视图 / resume / run-to-end / retry-step / cancel + 触发派发）全在 `AnalysisConfigService`（它持有 jobs/jobSteps/posts/providers/gateway），controller 仅校验入参与转译错误。`AnalysisConfigService` 与 `WorkerService` 构造函数因此各新增 `JobStepsRepository` 依赖（两处 assembly 已更新）。
4. **节点重认领的 attempts 语义**：`resumeInspectJob` 把 `attempts` 归零，使「逐节点重认领」不会把 attempts 累加触发僵死回收的 `max_attempts` 误判——每次放行＝该节点全新的尝试预算。
5. **`callRaw`/`normalize` 统一**：三个 provider 的 `analyze()` 重构为 `callRaw + normalizeRawOutput`（`normalizeRawOutput` 容错解析字符串或直接归一化 claude_cli 的对象），normal 与检视 normalize 节点共用同一归一化入口，杜绝行为分叉。
6. **worker 依赖 shared**：worker 现直接依赖 `@hatch-radar/shared`（消费节点产物契约类型）。
7. **检视内核测试落点**：检视执行内核（`runInspectJob`）只有 worker 进程承载，集成测试夹具在 `apps/api/test`，故 `inspect.spec.ts` 以相对路径直引 `apps/worker/src/worker.service` 源码（vitest 内联编译），用桩 `AnalysisConfigService` 隔离真实 AI。

## 未完（M4 及后续）

- 「发起分析」`/analyze` 页的「以单步模式分析选中的第一条」入口（当前入口为帖子详情按钮 + 队列「检视」跳转）。
- paused 任务超 N 小时自动取消的清理任务（保底；当前靠人工取消）。
- A/B 多模型并排检视、SSE/WS 替代轮询、演示态视觉打磨。
