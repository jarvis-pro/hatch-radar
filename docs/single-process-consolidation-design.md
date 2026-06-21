# 单进程归一设计（退役独立 worker）

> 状态：**定稿待实现** · 日期：2026-06-21
> 反转：[worker-push-gateway-design.md](worker-push-gateway-design.md)（WS push 网关 + 独立 worker 进程）
> 关联：[blueprint-lifecycle-design.md](blueprint-lifecycle-design.md)（执行内核 = 通用 task/stage 模型，本次不动）、[pipeline-inspector-design.md](pipeline-inspector-design.md)（逐节点检视，本次不动）

---

## 0. 一句话

把 `apps/api`（控制面）+ `apps/worker`（数据面）两个进程**合并成单个 api 进程**：保留 PostgreSQL 任务队列、检查点、闸门、僵死回收等全部持久化机制，**只把进程间通信（WS push 网关）换成进程内直接函数调用**。**零数据库迁移、零执行语义变更。**

---

## 1. 背景与动机

### 1.1 现状

恒两进程后端（见 CLAUDE.md「架构」）：

- **`apps/api`** —— 控制面，单实例。HTTP `/api` + 鉴权 + `@Cron` 调度 + **WS push 网关** + 同源托管 web SPA + 种子。
- **`apps/worker`** —— 数据面，NestJS standalone context，可横向扩 N 实例。无 HTTP、无调度，靠 PG 队列 `FOR UPDATE SKIP LOCKED` 认领 task、WS 连 api 网关、跑 AI 写回。

两者经 **PG 持久化队列 + WS 网关**解耦。

### 1.2 为什么要砍掉 worker

| 维度                 | 判断                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **负载性质**         | 真正吃 CPU / 内存的是云端 AI（Anthropic / OpenAI / DeepSeek 的 HTTP 调用）或本机 `claude` 子进程；本进程只是**发起请求 + 等 I/O**，是 I/O-bound 而非 CPU-bound。 |
| **横向扩展的必要性** | 当前体量下单进程的并发上限（`WORKER_CONCURRENCY`）足以喂满出站请求闸；多 worker 抢同一 PG 队列带来的不是吞吐而是复杂度。                                         |
| **claude_cli 模式**  | 订阅模式（`claude_cli`）本就**只能单实例**（依赖宿主机已登录的 claude，容器内不可用，见 docker-compose 注释）。双进程在这个最常用的本地模式下没有任何横扩收益。  |
| **运维复杂度**       | WS 网关、worker 注册表、三重心跳、断连重连、驱逐、兜底分发——这些全是为「跨进程可靠通信」付出的代价，单进程一笔勾销。                                             |

**结论**：双进程的可扩展性收益在当前场景near-zero，而其复杂度成本是实打实的。合并是正确的简化。

### 1.3 必须保留什么（不是「推倒重来」）

合并 ≠ 丢掉双进程时代沉淀的可靠性机制。下列**全部原样保留**，因为它们与「几个进程」无关，只与「任务可靠执行」有关：

- **PG 持久化队列**（`tasks` / `task_stages`）——崩溃重启不丢任务。
- **逐环节检查点**（`task_stages.output`）——重认领从下一环节续跑，「所见即所跑」。
- **闸门 + 重认领**（检视器的 `paused` → 放行 → `queued`）。
- **僵死回收**（心跳超时 → 重排 / 失败）。
- **出站请求闸**（`request_queue` / `request_lanes` + lane 暂停）。
- **多 Key 故障转移**（`key-failover.ts`）。

---

## 2. 现状架构精确剖析

### 2.1 双进程数据流（关键路径）

```
┌─────────────────────────── apps/api（控制面，单实例）───────────────────────────┐
│                                                                                 │
│  SchedulerCron @Cron('*/15 * * * * *')  ──► SchedulerService.heartbeat()        │
│        │                                         │                              │
│        │                                         ├─ pipeline.fireDueProcesses() │
│        │                                         └─ pipeline.finalizeRunningRuns│
│        ▼                                                                         │
│  PipelineService.run{Collect,Recheck,Analyze}Sweep()                            │
│        │  ① runs.createRun() + tasks.createTaskWithStages()（入队 task + stages）│
│        │  ② void this.gateway?.tryDispatch()  ◄── gateway 是可选 Dispatcher      │
│        ▼                                                                         │
│  GatewayService (implements Dispatcher)                                          │
│        │  tryDispatch(): pickWorker() + tasks.claimNextTask() + WS send          │
│        ▼                                                                         │
│  WebSocketServer  /ws/worker  ════════ WS ════════╗                              │
└───────────────────────────────────────────────────╫─────────────────────────────┘
                                                     ║
┌────────────────────────── apps/worker（数据面，N 实例）╫───────────────────────────┐
│  WorkerAgentService (WS client)  ◄════════════════╝                              │
│        │  收 dispatch_task{taskId} → worker.executeDispatchedTask(taskId)         │
│        ▼                                                                         │
│  WorkerService.runTask(taskId)                                                   │
│        │  逐环节 for(;;): execStage → markStageDone（检查点）→ 闸门? paused : 续  │
│        │  心跳 15s / 超时 jobTimeoutMs / 僵死回收 60s                            │
│        ▼                                                                         │
│  CollectionExecutor（discover/collect/recheck）· execNode（analyze 6 节点）       │
│  · TranslationService（translate）· RequestGate（出站闸）                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 进程间通信的两个抓手

整套跨进程机制收敛到 **kernel 的一个接口**：

```ts
// packages/kernel/src/protocol.ts
export interface Dispatcher {
  tryDispatch(): Promise<void>; // 入队后触发一次派发
}
```

- **生产侧**：`PipelineService` 持有 `private readonly gateway?: Dispatcher`，每次入队后 `void this.gateway?.tryDispatch()`。它**只认接口，不认实现**。
- **实现侧**：`GatewayService implements Dispatcher`（WS 版）。`tryDispatch()` = 选一个空闲 worker + 认领一条 task + WS 推送。
- **消费侧**：`WorkerService.executeDispatchedTask(taskId)` —— 一个**干净的、与传输无关的单任务执行入口**。

> ★ 核心洞察：`PipelineService → Dispatcher → WorkerService` 这条链里，**WS 只活在 `GatewayService` 这一个类里**。换掉这个类的实现，上下游都不用动。

### 2.3 并发控制现状（合并时必须复刻的语义）

并发上限**不在 worker 自己**，而在 gateway：

- `WorkerService.executeDispatchedTask` 只用 `activeJobPromises[]` 追踪在途，**自身不限流**。
- `GatewayService.pickWorker()` 用 `w.activeJobs < w.concurrency` 把关，且 `tryDispatch()` **一次只认领一条**。
- 多任务靠**链式触发**（每个 `task_result` 回来再 `tryDispatch()`）+ **fallbackTimer（10s 兜底）**驱动。

→ 合并后需要一个**进程内并发闸**复刻「`activeJobs < concurrency` + 链式补位 + 兜底周期」这三件事。

### 2.4 涉及文件清单（现状）

| 角色                      | 文件                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatcher 接口 + WS 协议 | `packages/kernel/src/protocol.ts`                                                                                                                        |
| WS 网关（api 侧）         | `apps/api/src/domain/gateway/gateway.service.ts`                                                                                                         |
| 网关生命周期薄封装        | `apps/api/src/gateway/gateway.module.ts`、`apps/api/src/gateway/gateway.starter.ts`                                                                      |
| 生产侧                    | `apps/api/src/domain/pipeline/pipeline.service.ts`（`gateway?: Dispatcher`）                                                                             |
| 调度                      | `apps/api/src/domain/scheduler/scheduler.service.ts`、`apps/api/src/scheduler/scheduler.cron.ts`                                                         |
| api 装配                  | `apps/api/src/domain/assembly.ts`、`apps/api/src/core/core.module.ts`、`apps/api/src/app.module.ts`                                                      |
| worker 进程               | `apps/worker/src/`（main / module / starter / assembly / **worker.service** / **collection.executor** / **request-gate** / worker-agent / env / tokens） |
| 部署 / 脚本               | `docker-compose.yml`、根 `package.json`、`Dockerfile`                                                                                                    |

---

## 3. 目标架构

### 3.1 单进程拓扑

```
┌────────────────────────── apps/api（唯一进程）────────────────────────────────┐
│                                                                               │
│  SchedulerCron @Cron ──► SchedulerService.heartbeat()                         │
│        ▼                                                                       │
│  PipelineService.run*Sweep()                                                   │
│        │  ① 入队 task + stages                                                 │
│        │  ② void this.gateway?.tryDispatch()   ◄── gateway 仍是 Dispatcher     │
│        ▼                                                                       │
│  LocalDispatcher (implements Dispatcher)   ★ 新增，替换 GatewayService          │
│        │  while(inFlight < concurrency){ claimNextTask(); inFlight++;          │
│        │     void worker.executeDispatchedTask(id).finally(补位 tryDispatch) } │
│        │  + fallbackTimer 10s 兜底                                             │
│        ▼  （进程内直接函数调用，无 WS、无序列化）                                │
│  WorkerService.executeDispatchedTask(taskId)   ◄── 从 apps/worker 原样搬入      │
│        ▼                                                                       │
│  CollectionExecutor · execNode(analyze) · TranslationService · RequestGate     │
│        ▼                                                                       │
│  PostgreSQL（tasks / task_stages / runs / request_* …）—— 一字不改             │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 变化总览

| 机制                 | 双进程                                      | 单进程                      | 改动               |
| -------------------- | ------------------------------------------- | --------------------------- | ------------------ |
| 入队 → 派发触发      | `PipelineService` → `Dispatcher`            | **不变**                    | ✅ 零改动          |
| Dispatcher 实现      | `GatewayService`（WS）                      | `LocalDispatcher`（进程内） | 🔁 换实现          |
| 任务认领             | `claimNextTask`（`FOR UPDATE SKIP LOCKED`） | **不变**                    | ✅ 保留（见 §6.3） |
| 单任务执行           | `WorkerService.executeDispatchedTask`       | **不变**（搬位置）          | 📦 git mv          |
| 并发上限             | gateway `pickWorker` 把关                   | `LocalDispatcher` 进程内闸  | 🔁 复刻语义        |
| 检查点 / 闸门 / 续跑 | `task_stages` + 重认领                      | **不变**                    | ✅ 保留            |
| 僵死回收             | `WorkerService.start()` 60s                 | **不变**                    | ✅ 保留            |
| 出站请求闸           | `RequestGate` + `request_*`                 | **不变**                    | ✅ 保留            |
| 跨进程通信           | WS `/ws/worker` + 注册表 + 心跳             | —                           | ❌ 删除            |
| 横向扩展             | worker N 实例                               | 单进程并发                  | ⚠️ 放弃（见 §7）   |

---

## 4. LocalDispatcher 设计（核心新增）

唯一真正「新写」的组件。完整骨架：

```ts
// apps/api/src/domain/worker/local-dispatcher.ts
import { TasksRepository } from '@hatch-radar/db';
import { logger, nowSec, type Dispatcher } from '@hatch-radar/kernel';
import { WorkerService } from './worker.service';

/** 兜底泵周期：捡漏非 pipeline 入队的任务（检视放行 paused→queued、手动重排 failed→queued）。 */
const FALLBACK_PUMP_MS = 10_000;

/**
 * 进程内派发器（替换 WS 版 GatewayService）：在同一进程里认领任务并直接调 WorkerService 执行。
 *
 * 复刻 GatewayService 的三条语义：
 *   ① 并发上限 —— inFlight < concurrency（= 旧 pickWorker 的 activeJobs < concurrency）
 *   ② 链式补位 —— 每条任务结束后 finally 再 tryDispatch（= 旧 task_result 后的 tryDispatch）
 *   ③ 兜底周期 —— fallbackTimer（= 旧 GatewayService.fallbackTimer）
 * pumping 单飞标志杜绝并发重入导致的超发。
 */
export class LocalDispatcher implements Dispatcher {
  private inFlight = 0;
  private pumping = false;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tasks: TasksRepository,
    private readonly worker: WorkerService,
    private readonly concurrency: number,
  ) {}

  /** 入队后 / 任务完成后 / 兜底周期触发：尽量把并发名额填满。 */
  async tryDispatch(): Promise<void> {
    if (this.pumping) return; // 单飞：认领循环不可并发重入
    this.pumping = true;
    try {
      while (this.inFlight < this.concurrency) {
        const task = await this.tasks.claimNextTask(nowSec());
        if (!task) break; // 队列空
        this.inFlight++;
        void this.worker
          .executeDispatchedTask(task.id)
          .catch((err) => logger.error(`[dispatch] task#${task.id} 顶层异常: ${String(err)}`))
          .finally(() => {
            this.inFlight--;
            void this.tryDispatch(); // 腾出名额，补位认领
          });
      }
    } finally {
      this.pumping = false;
    }
  }

  /** 对应 NestJS onApplicationBootstrap：起兜底泵。 */
  start(): void {
    this.fallbackTimer = setInterval(() => void this.tryDispatch(), FALLBACK_PUMP_MS);
  }

  /** 对应 NestJS beforeApplicationShutdown：停止认领新任务（在途由 WorkerService.stop 排空）。 */
  stop(): void {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
  }
}
```

### 4.1 语义对照

| GatewayService（WS）                                   | LocalDispatcher（进程内）                |
| ------------------------------------------------------ | ---------------------------------------- |
| `pickWorker()` 选 `activeJobs < concurrency` 的 worker | `while (inFlight < concurrency)`         |
| `tryDispatch` 一次派一条                               | `while` 循环一次填满名额                 |
| `task_result` 回来后 `tryDispatch()`                   | `.finally(() => tryDispatch())` 链式补位 |
| `fallbackTimer` 10s                                    | `fallbackTimer` 10s（同值）              |
| `worker.activeJobs++` / 心跳上报                       | `inFlight++/--`（无需上报，同进程）      |
| 注册表 / 驱逐 / 断连重连                               | **不需要**（无远端 worker）              |

### 4.2 为什么 `pumping` 单飞标志是必要的

`tryDispatch()` 会被三个源并发触发：pipeline 入队、`.finally` 补位、fallbackTimer。若两个调用同时进入 `while` 顶部都看到 `inFlight == concurrency - 1`，可能各自再认领一条造成轻微超发。`pumping` 让认领循环串行化：同一时刻只有一个泵在 claim，杜绝超发。（`FOR UPDATE SKIP LOCKED` 已保证不会重复执行同一 task，`pumping` 进一步保证不超并发上限。）

---

## 5. 落地步骤（建议分两阶段，各自可独立验证 / 回滚）

### 阶段一：api 内置执行能力（worker app 暂时保留）

目标：api 单进程即可自给自足跑完整链路；`apps/worker` 仍在但默认不启动，作为「随时能回滚到双进程」的保险。

**S1-1　搬执行器入 api domain**（纯 `git mv`，import 全是包名，无需改）

```
apps/worker/src/worker.service.ts      → apps/api/src/domain/worker/worker.service.ts
apps/worker/src/collection.executor.ts → apps/api/src/domain/worker/collection.executor.ts
apps/worker/src/request-gate.ts        → apps/api/src/domain/worker/request-gate.ts
```

> 这三个文件 import 的全是 `@hatch-radar/*` 包与同目录 `./`，搬位置后**一行 import 都不用改**。

**S1-2　新建 `LocalDispatcher`**：`apps/api/src/domain/worker/local-dispatcher.ts`（见 §4）。

**S1-3　api env 增加并发配置**：`apps/api/src/config/env.ts` 加 `WORKER_CONCURRENCY`（默认 20，与 worker 旧默认一致），并让 `databasePoolMax` 默认 `Math.max(10, concurrency + 5)`（复刻 worker 旧逻辑，避免连接池不够）。

**S1-4　改装配 `createCore`**（`apps/api/src/domain/assembly.ts`）：

```ts
// 新增：worker 侧实例（原 createWorkerCore 的内容并入）
const requestGate = new RequestGate(requestQueue, requestLanes);
const analysisExec = new AnalysisService(insights);
const collection = new CollectionExecutor(
  crawlerConfig,
  hackernews,
  sources,
  posts,
  comments,
  tasks,
  runs,
  analysisConfig,
  requestGate,
);
const worker = new WorkerService(
  tasks,
  taskStages,
  runs,
  posts,
  comments,
  analysisExec,
  analysisConfig,
  translation,
  runtimeSettings,
  collection,
);
const localDispatcher = new LocalDispatcher(tasks, worker, env.workerConcurrency);

// 改：PipelineService 的 dispatcher 从 gateway 换成 localDispatcher
const pipeline = new PipelineService(
  blueprints,
  runs,
  tasks,
  taskStages,
  posts,
  analysisConfig,
  runtimeSettings,
  providers,
  processes,
  localDispatcher, // ◄── 原来是 gateway
);

// 返回对象增加 worker / localDispatcher；移除 gateway（阶段二）或暂时并存（阶段一）
return { /* …, */ worker, localDispatcher /*, gateway 阶段一可暂留 */ };
```

**S1-5　生命周期薄封装**：新建 `apps/api/src/worker/worker.starter.ts`（NestJS `@Injectable`）：

```ts
@Injectable()
export class WorkerStarter implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(
    @Inject(WorkerService) private readonly worker: WorkerService,
    @Inject(LocalDispatcher) private readonly dispatcher: LocalDispatcher,
  ) {}
  async onApplicationBootstrap() {
    await this.worker.start(); // 回收遗留 running + 起僵死回收定时器
    this.dispatcher.start(); // 起兜底泵
    void this.dispatcher.tryDispatch(); // 启动即捡一轮存量 queued
  }
  beforeApplicationShutdown() {
    // 早于 HTTP 关闭：先停认领
    this.dispatcher.stop();
  }
  async onApplicationShutdown() {
    await this.worker.stop(); // 排空在途任务
  }
}
```

在 `core.module.ts` 用 `fromCore(WorkerService, 'worker')` + `fromCore(LocalDispatcher, 'localDispatcher')` 登记，并在某个 feature module（新建 `WorkerModule` 或并入现有）里 `providers: [WorkerStarter]`。

**S1-6　冒烟验证单进程**：仅起 api（不起 worker），跑通：

- collect sweep → discover → 派生 collect → 抓评论 → 派生 analyze → 出洞察；
- 检视器逐节点 暂停 / 放行；
- 翻译任务；
- 杀进程重启 → 僵死回收 + 续跑。

✅ 阶段一交付后，**双进程仍可用**（worker app 还在、WS 网关还在），随时回滚。

---

### 阶段二：物理删除 worker 与 WS 网关

确认阶段一稳定后，删干净。

**S2-1　删 worker app**：`rm -rf apps/worker`（worker.service / collection.executor / request-gate 已在 S1-1 搬走；剩 main / module / starter / assembly / worker-agent / env / tokens 全删）。

**S2-2　删 WS 网关（api 侧）**：

- `apps/api/src/domain/gateway/gateway.service.ts`
- `apps/api/src/gateway/`（gateway.module.ts + gateway.starter.ts）

**S2-3　清协议**：`packages/kernel/src/protocol.ts` 删 `WorkerMessage` / `GatewayMessage`（含旧 `job_*` / `dispatch` 类型），**保留 `Dispatcher` 接口**（LocalDispatcher 仍实现它）。

**S2-4　清装配与接线**：

- `apps/api/src/domain/assembly.ts`：删 `GatewayService` 实例化与返回。
- `apps/api/src/domain/index.ts`：删 `export * from './gateway/gateway.service'`，加 worker / local-dispatcher 导出。
- `apps/api/src/core/core.module.ts`：删 `fromCore(GatewayService, 'gateway')` 与其 import。
- `apps/api/src/app.module.ts`：删 `GatewayModule` import。

**S2-5　脚本与部署**：

- 根 `package.json`：删 `dev:worker` / `start:worker`。
- `docker-compose.yml`：删 `worker` 服务块；更新 `x-backend` 注释（api 不再「+ push 网关」、不再有 worker）；`api` 块去掉对 worker 的描述。
- `Dockerfile`：共享镜像不必动（worker command 自然消失）；若有 worker 专属层则清理。

**S2-6　文档**：CLAUDE.md「架构」段从「恒两进程」改为「单进程」；README 同步；本文件标记「已实现」。

---

## 6. 关键决策与坑

### 6.1 执行器搬到 api domain，而非提成 `packages/worker-core`

CLAUDE.md 约定「API 独有逻辑进 api app，**2+ 消费方才成包**」。单进程后 `WorkerService` 只有 api 一个消费方，故搬进 `apps/api/src/domain/worker/`，**不提包**。

### 6.2 `claimNextTask` 的 `FOR UPDATE SKIP LOCKED` 保留不动

单进程下没有跨进程竞争，但保留**有益无害**：①兜底泵、链式补位、pipeline 入队三源会并发调 `tryDispatch`，行锁保证同一 task 不被两个并发认领循环重复领取（`pumping` 是第一道闸，行锁是第二道）；②改写它反而引入风险、收益为零。

### 6.3 `WorkerService` 的心跳 / 僵死回收照常运转

`WorkerService.start()` 的 60s 僵死回收在单进程下仍有意义：进程崩溃重启后，回收上次遗留的 `running` 任务（启动时 `reclaimRunningTasks(now, null)` 全量回收 + 周期回收超 `staleSeconds` 的）。**一字不改**。

### 6.4 优雅退出顺序

NestJS 关停顺序：`beforeApplicationShutdown` → dispose（关 HTTP）→ `onApplicationShutdown`。

- `beforeApplicationShutdown`：`dispatcher.stop()`（停止认领**新**任务）。
- `onApplicationShutdown`：`worker.stop()`（`Promise.allSettled(activeJobPromises)` 排空**在途**任务）。

注意：阶段二删掉 GatewayService 后，原 `GatewayStarter.beforeApplicationShutdown`（terminate WS）一并消失，不再有「关 HTTP 等 WS」的死锁顾虑。

### 6.5 测试夹具

api 集成测试跑真实 Nest 上下文。需确认：**测试期不应让 `WorkerStarter` 起兜底泵空跑认领**（否则测试库里的 task 会被后台泵抢跑，污染断言）。做法：测试 `AppModule` 不引入 `WorkerStarter`，或加 `env.workerAutostart` 开关（测试置 false）。这是阶段一必须一并处理的点。

### 6.6 `claude_cli` 子进程与事件循环

`claude_cli` provider 经 `@anthropic-ai/claude-agent-sdk` 起**独立子进程**——子进程 CPU/内存不占 Node 主事件循环（spawn 出去的，主循环只等其 I/O）。单进程并发 N 个 analyze = 并发 N 个 claude 子进程，由 `WORKER_CONCURRENCY` 直接封顶，与旧「单 worker 进程」行为一致。

---

## 7. 风险与权衡

| 风险                                                                         | 评估                                                                          | 缓解                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **失去横向扩展**                                                             | 用户已确认负载 I/O-bound、压力在云端，单进程并发足够                          | 保留 `WORKER_CONCURRENCY` 调并发；阶段一保留 worker app 可随时回滚到双进程横扩        |
| **故障域合并**：执行逻辑未捕获异常拖垮 HTTP                                  | `runTask` 内已对每环节 try/catch 落库；`LocalDispatcher` 顶层再 `.catch` 兜底 | 确保 `executeDispatchedTask` 永不向上抛（已是现状）；进程级 `unhandledRejection` 日志 |
| **事件循环抖动**：`normalize`（JSON 解析）/ `buildContext`（拼串）是同步 CPU | 均为毫秒级、量小；HTTP 与执行同循环时极端大输入可能引入延迟尖刺               | `WORKER_CONCURRENCY` 控制同时活跃数；如实测有抖动，未来可针对超大上下文降并发         |
| **连接池争用**：HTTP 查询与任务执行共用 PG 池                                | 旧双进程各自独立池，合并后共享                                                | `databasePoolMax = max(10, concurrency+5)`（复刻 worker 旧算法），按需上调            |
| **长任务阻塞优雅退出**                                                       | `worker.stop()` 等在途任务排空，可能拖长关停                                  | `jobTimeoutMs` 已封顶单环节耗时；可加关停总超时强退                                   |

---

## 8. 零迁移声明

**本次重构不含任何数据库 schema 变更。**

`tasks` / `task_stages` / `runs` / `blueprints` / `processes` / `request_queue` / `request_lanes` 等表的结构与语义**完全不变**。这是一次**纯应用层**的进程拓扑与通信方式调整。因此：

- 无需 `db:migrate:dev`；
- 现有数据（在途 task、检查点、闸门状态）在新单进程下可**无缝续跑**；
- 回滚不涉及数据回退。

---

## 9. 删 / 改 / 搬 文件清单（速查）

**📦 搬（git mv，import 不改）**

- `apps/worker/src/{worker.service,collection.executor,request-gate}.ts` → `apps/api/src/domain/worker/`

**✨ 新建**

- `apps/api/src/domain/worker/local-dispatcher.ts`
- `apps/api/src/worker/worker.starter.ts`（+ 可选 `worker.module.ts`）

**🔧 改**

- `apps/api/src/domain/assembly.ts`（装配 worker + LocalDispatcher；PipelineService 换 dispatcher）
- `apps/api/src/domain/index.ts`（导出增减）
- `apps/api/src/core/core.module.ts`（fromCore 增减）
- `apps/api/src/app.module.ts`（imports 增减）
- `apps/api/src/config/env.ts`（加 `WORKER_CONCURRENCY` + 池默认）
- `packages/kernel/src/protocol.ts`（删 WS 消息类型，留 `Dispatcher`）
- 根 `package.json`（删 worker scripts）
- `docker-compose.yml`（删 worker 服务 + 注释）
- `CLAUDE.md` / `README.md`（架构描述）

**❌ 删**

- `apps/worker/`（整目录）
- `apps/api/src/domain/gateway/gateway.service.ts`
- `apps/api/src/gateway/`（module + starter）

---

## 10. 验收清单

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm lint` 全绿
- [ ] `pnpm test`（api 集成测试）全绿，且测试期无后台泵干扰
- [ ] 冒烟：仅 `pnpm dev:api`（不起 worker）跑通 collect→discover→collect→analyze→洞察
- [ ] 冒烟：检视器逐节点 暂停 / 放行 续跑
- [ ] 冒烟：翻译任务出译文
- [ ] 冒烟：执行中 `kill` 进程后重启，僵死回收 + 检查点续跑
- [ ] 出站请求闸：lane 暂停 / 恢复仍生效
- [ ] 并发：入队批量任务，活跃数稳定 ≤ `WORKER_CONCURRENCY`，无超发
- [ ] 优雅退出：`SIGTERM` 后在途任务排空、无 HALF-OPEN / 死锁
- [ ] `docker compose --profile full up` 单 api 容器（无 worker）健康

---

## 11. 工作量与提交切分

| 提交 | 内容                                                            | 风险                           |
| ---- | --------------------------------------------------------------- | ------------------------------ |
| C1   | S1-1 搬执行器（git mv）+ S1-3 env                               | 低（无行为变化）               |
| C2   | S1-2 LocalDispatcher + S1-4 装配 + S1-5 starter + S1-6 测试夹具 | **中**（核心行为切换）         |
| C3   | 阶段一冒烟修复（如有）                                          | 低                             |
| C4   | S2-1~S2-4 删 worker + WS 网关 + 清接线                          | 中（删除面大，typecheck 兜底） |
| C5   | S2-5 脚本 / docker + S2-6 文档                                  | 低                             |

阶段一（C1–C3）交付即可单进程运行且可回滚；阶段二（C4–C5）做减法收尾。建议 C1–C3 一个 PR、C4–C5 一个 PR。
