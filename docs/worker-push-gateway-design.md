# Worker Push 网关改造设计

## 一、背景

### 现状（Pull 模式）

```
Scheduler ──→ analysis_jobs (PG)
                    ↑
Worker A  ──轮询──┘ FOR UPDATE SKIP LOCKED
Worker B  ──轮询──┘
Worker C  ──轮询──┘
```

worker 每 2 秒主动轮询数据库抢锁，自治认领任务。网关不存在，调度控制权在 worker 侧。

### 目标（Push 模式）

```
Scheduler ──→ GatewayService ──→ Worker A（负载 20%）
                    │       ╲──→ Worker B（负载 55%）
                    │         ╲→ Worker C（负载 80%，跳过）
                    │
              [注册表]
              A: cpu 20%, mem 40%, active 1/2
              B: cpu 55%, mem 60%, active 2/2  ← 已满，跳过
              C: cpu 80%, mem 70%, active 0/2
```

网关维护 worker 注册表，按负载主动推送任务，worker 被动接收执行。

---

## 二、整体架构

### 组件划分

| 组件                  | 位置                  | 职责                                   |
| --------------------- | --------------------- | -------------------------------------- |
| `GatewayService`      | `main.ts` 进程        | 维护注册表、接收任务入队请求、分发任务 |
| `WorkerAgent`         | `worker-main.ts` 进程 | 启动注册、接收任务推送、上报心跳/结果  |
| `WorkerRegistry`      | 内存                  | 存储 worker 状态快照（不持久化）       |
| `analysis_jobs`（PG） | 不变                  | 只做持久化存档，不再做队列协调         |

### 通信协议选型：WebSocket

- worker 启动后主动连接 gateway 的 WS 端点 `/ws/worker`
- 长连接双向通信，gateway 推任务，worker 回结果/心跳
- 比 HTTP 轮询省资源；比 gRPC 简单，NestJS 原生支持

---

## 三、通信协议设计

### 消息格式（JSON）

```typescript
// worker → gateway
type WorkerMessage =
  | { type: 'register'; workerId: string; concurrency: number }
  | { type: 'heartbeat'; workerId: string; cpu: number; memory: number; activeJobs: number }
  | {
      type: 'job_result';
      workerId: string;
      jobId: number;
      status: 'succeeded' | 'failed';
      error?: string;
    }
  | { type: 'job_progress'; workerId: string; jobId: number }; // 心跳保活，防僵死回收

// gateway → worker
type GatewayMessage =
  | { type: 'registered'; workerId: string }
  | { type: 'dispatch'; jobId: number; postId: string; providerId: number; model: string }
  | { type: 'ping' };
```

### 握手流程

```
Worker 启动
    │
    ├─→ WS connect → /ws/worker
    │
    ├─→ send { type: 'register', workerId, concurrency: 2 }
    │
    ←─ recv { type: 'registered', workerId }
    │
    └─→ 进入就绪状态，等待 dispatch 消息
```

---

## 四、WorkerRegistry 设计

纯内存结构，网关重启时 worker 重连即自动重建：

```typescript
interface WorkerState {
  workerId: string;
  socket: WebSocket;
  concurrency: number; // worker 声明的最大并发数
  activeJobs: number; // 当前正在执行的任务数
  cpu: number; // 最近一次上报的 CPU 使用率（0-1）
  memory: number; // 最近一次上报的内存使用率（0-1）
  lastHeartbeat: number; // unix ms，超 30s 踢出注册表
  connectedAt: number;
}
```

### 注册表操作

| 操作                           | 触发时机                         |
| ------------------------------ | -------------------------------- |
| `register(worker)`             | WS 连接 + register 消息          |
| `updateHeartbeat(id, metrics)` | 收到 heartbeat 消息（每 10s）    |
| `markJobStart(id)`             | gateway dispatch 后 activeJobs++ |
| `markJobDone(id)`              | 收到 job_result 后 activeJobs--  |
| `evict(id)`                    | 心跳超时 / WS 断开               |

---

## 五、任务分发策略

### 触发点

两种情况触发分发：

1. **新任务入队时**（调度器 / 手动触发）→ 立即尝试分发
2. **worker 完成任务时**（activeJobs 减少）→ 检查队列有无等待任务

### 选 worker 算法：加权最小负载

```
可用 worker = 注册表中 activeJobs < concurrency 的 worker

排序依据（优先级从高到低）：
  1. activeJobs 最少（空闲槽位最多）
  2. cpu 最低
  3. memory 最低

取第一个 → dispatch
```

### 分发失败兜底

如果所有 worker 都满载（`activeJobs >= concurrency`），任务留在 `analysis_jobs` 表中保持 `queued` 状态，等下次有 worker 完成任务时触发重新分发。不引入新的等待队列，PG 表本身就是持久化的等待队列。

---

## 六、故障处理

### Worker 进程崩溃

```
WS 断开
    │
    ├─→ Gateway 收到 close 事件
    ├─→ WorkerRegistry.evict(workerId)
    ├─→ 查询该 worker 正在执行的 jobs（status=running）
    └─→ 回收为 queued（如 attempts < max_attempts），等待重分发
```

### Gateway 进程重启

```
Gateway 重启
    │
    ├─→ WorkerRegistry 清空（内存丢失）
    ├─→ 所有 WS 连接断开
    ├─→ Worker 收到 close 事件，触发重连逻辑（指数退避，最长 30s）
    └─→ Worker 重连后重新 register，注册表自动重建
```

遗留的 `running` 状态任务，由现有的僵死回收机制（heartbeat 超时 → 回 queued）兜底，无需新增逻辑。

### Worker 假死（进程存活但卡住）

保留现有 `job_progress` 心跳 + `WORKER_STALE_SECONDS` 回收机制不变。

---

## 七、改造范围

### 新增文件

```
apps/server/src/
├── gateway/
│   ├── gateway.module.ts          [NestJS 模块]
│   ├── gateway.service.ts         [注册表 + 分发逻辑]
│   └── gateway.gateway.ts         [WebSocket 网关，@WebSocketGateway]
└── worker/
    └── worker-agent.service.ts    [worker 侧 WS 客户端]
```

### 修改文件

| 文件                                  | 改动                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `worker/worker.service.ts`            | 移除轮询 loop；改为接收 `dispatch` 消息后执行任务；执行完调用 agent 上报结果 |
| `worker/worker-standalone.module.ts`  | 引入 `WorkerAgentService`                                                    |
| `app.module.ts`                       | 引入 `GatewayModule`                                                         |
| `analysis/analysis-config.service.ts` | 入队后调用 `GatewayService.tryDispatch()` 触发立即分发                       |

### 不变的部分

| 组件                   | 原因                                                 |
| ---------------------- | ---------------------------------------------------- |
| `jobs.repository.ts`   | 状态流转 SQL 不变，gateway 调用 `succeedJob/failJob` |
| `analysis_jobs` 表结构 | 无需改动                                             |
| 僵死回收逻辑           | 作为兜底保留                                         |
| `worker-main.ts` 入口  | 进程结构不变                                         |
| `main.ts`              | 只需引入 GatewayModule                               |

---

## 八、新增依赖

```
@nestjs/websockets    ← NestJS WS 模块（官方包，已在 nest 生态内）
@nestjs/platform-ws   ← 或继续用 platform-express + ws adapter
ws                    ← worker 侧 WS 客户端
```

---

## 九、迁移路径

建议分两步走，不停服：

**Step 1：双轨并行**

- 部署 GatewayService，worker 同时保留轮询 loop
- Gateway 分发成功的任务不进 PG 队列；轮询作为兜底
- 观察 Gateway 分发覆盖率，逐步建立信心

**Step 2：切换**

- 确认 Gateway 分发稳定后，移除 worker 轮询 loop
- 入队路径全部走 Gateway 触发分发
- 保留僵死回收作为最终兜底

---

## 十、改造收益 vs 代价

| 维度         | Pull（现在）          | Push（改造后）                    |
| ------------ | --------------------- | --------------------------------- |
| 扩容方式     | 加进程即可            | 加进程即可（不变）                |
| 负载感知调度 | 无                    | 有（按 CPU/内存选 worker）        |
| 任务分发延迟 | 最高 2s（轮询间隔）   | 毫秒级（即时推送）                |
| PG 查询压力  | N worker × 每 2s 轮询 | 无轮询，仅写操作                  |
| 架构复杂度   | 低                    | 中（增加 WS 长连接管理）          |
| 单点风险     | 无                    | Gateway 重启期间约 1-30s 分发中断 |
| 新增代码量   | —                     | ~300 行（gateway + agent）        |
