# hatch-radar Server 重构计划书：NestJS + PostgreSQL

> 本文件是一次 server 端较大重构的实施计划，供**新会话从零接手**。读本文件 + 现有代码即可开工，无需依赖此前对话上下文。
> 决策已敲定：`apps/server` 由"裸跑 Node + better-sqlite3"迁移到 **NestJS（默认 Express 适配器）+ PostgreSQL（Drizzle ORM）**；`apps/web` 数据访问随之从直读 SQLite 改为只读 PG；`apps/mobile` 维持 `expo-sqlite` 离线不变。

---

## 0. 一页速览（TL;DR）

| 维度   | 现状                                                                                | 目标                                            |
| ------ | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| HTTP   | `node:http` 手写路由（[http.ts](../apps/server/src/server/http.ts) 351 行 if/else） | NestJS Controller + DTO + Guard + 全局异常过滤  |
| 框架   | 无，main() 手动 wiring                                                              | Nest IoC/DI + 生命周期钩子                      |
| 数据库 | better-sqlite3（同步、单文件、进程内）                                              | PostgreSQL（异步、连接池、多后端并发）          |
| 数据层 | 手写 SQL，~40 处 `getDb()` / ~97 处 prepare/run                                     | Drizzle 异步 repository（Nest provider）        |
| 调度   | node-cron                                                                           | `@nestjs/schedule` `@Cron`（保留 guard 非重入） |
| worker | 进程内 worker 池，SQLite 同步事务认领                                               | 可独立进程，PG `FOR UPDATE SKIP LOCKED` 认领    |
| 工具链 | tsx watch（esbuild）                                                                | nest CLI + swc builder                          |

**换 PG 的唯一理由是并发**：现状 better-sqlite3 同步阻塞，定时器 + 多人局域网操作全部串行在一条事件循环上；PG 异步驱动 + 连接池让它们真正并行。单条操作 PG 反而更慢——收益在并发吞吐与尾延迟，不在单点速度。

**必须保护的两条向后兼容契约（mobile 依赖）**：

1. **HTTP 同步/导出 API**（路径、请求/响应结构不变）；
2. **导出 `.sqlite` 文件格式**——server 换 PG 后，导出仍须产出标准 SQLite 文件供 mobile `ATTACH` 合并（见 [mobile/src/db/schema.ts](../apps/mobile/src/db/schema.ts)）。

---

## 1. 背景与动机

server 组件持续变多（爬虫 + 评论补全 + AI 分析 worker 池 + 持久化任务队列 + 局域网导出/同步 HTTP + 多个 CLI 入口），裸跑导致：

- HTTP 层是一坨重复的手写梯子（method→auth→readBody→parse→校验→send），每加一个端点就复制一遍；
- 缺少 DI / 模块约定，wiring 全在 `main()` 手攒；
- **并发瓶颈**：用户明确场景为"操作时定时器也在写 + 局域网内多人操作"。better-sqlite3 同步阻塞事件循环，有效并发 = 1，一次重查询/重写会冻住所有人。

目标：用 Nest 收敛结构、用 PG 解锁真并发、把 worker 从单进程里解耦出来。

---

## 2. 范围与边界

### 2.1 在范围内

- **`apps/server`**：全量框架化（Nest）+ 数据层换 PG（Drizzle）+ worker 可拆进程 + CLI 入口收编进进程。
- **`apps/web`**：DB 访问从 `better-sqlite3 readonly`（[web/src/lib/db.ts](../apps/web/src/lib/db.ts)）改为 **PG 只读**；[queries.ts](../apps/web/src/lib/queries.ts) 全部 SELECT 改写。
- **`packages/shared`**：schema 拆分（见 §4.4）。**类型不变**（`PostRow` / `CommentRow` / `InsightResult` / `TriageRow` / `Intensity` 等保持共享）。

### 2.2 不在范围内（但必须保护契约）

- **`apps/mobile`**：保持 `expo-sqlite` 离线本地库不变，写操作仍走 HTTP 同步上行。
- **共享 SQLite DDL 不删除**：mobile 本地建表 + server 导出 `.sqlite` 仍需要它（见 [shared/src/schema.ts](../packages/shared/src/schema.ts) / [triage.ts](../packages/shared/src/triage.ts)）。

---

## 3. 目标架构

```
                        ┌──────────────────────────── apps/server (NestJS) ────────────────────────────┐
   Reddit/HN/RSS ──▶ Crawler ──▶ │                                                                          │
                        │  ScheduleModule(@Cron): scan / comments / analyze-enqueue / archive            │
                        │  Repositories (Drizzle, async) ──────────────────────────┐                    │
                        │  HTTP Controllers (sync/export/import/lock/doc/health)    │                    │
                        └───────────────────────────────────────────────────────────┼────────────────────┘
                                                                                     ▼
                                                                          ┌────────────────────┐
        Worker 进程（可独立）  ◀── analysis_jobs: FOR UPDATE SKIP LOCKED ──│   PostgreSQL       │
        （消费队列 → 调 LLM → 落 insights）                                 │  (Drizzle schema)  │
                                                                          └─────────┬──────────┘
                                                                                    │ 只读
   apps/web (Next.js) ──── 直连 PG 只读（RSC 直查）──────────────────────────────────┘

   导出路径： Controller ──▶ 读 PG ──▶ writeBatchSqlite（better-sqlite3，仅此处）──▶ .sqlite 文件
                                                                          │ HTTP 下载
   apps/mobile (expo-sqlite, 离线) ◀── ATTACH 合并 .sqlite ───────────────┘ ；研判操作 ──HTTP 同步──▶ server
```

要点：

- **PG 成为 server + web 的唯一主存储**；
- **better-sqlite3 在 server 端只剩一个用途**——`writeBatchSqlite` 产出导出文件（数据源改为读 PG），保留为依赖但不再是主库；
- **worker 可独立成进程**，靠 PG 行锁认领，与 HTTP 服务解耦。

---

## 4. 关键技术决策

### 4.1 框架：NestJS（默认 Express 适配器）

选 Nest 的理由（详见对话结论）：生态/资料/可问性最强、AI 协作准确率高、`@nestjs/schedule` 与生命周期钩子和现有 cron/worker 几乎一一对应。

**HTTP 适配器选默认的 Express，不上 Fastify**：Nest 把 HTTP 层抽象掉了，业务代码（Controller/Service/Guard/Pipe）与适配器无关；Fastify 唯一独有优势是裸吞吐，而你是局域网少量用户、并发问题已交给 PG，用不到。Express 是 Nest 默认、例子最多、AI 帮你写最准（正是选 Nest 的初衷）。日志用 `nestjs-pino`（与现有 [logger.ts](../apps/server/src/logger.ts) 一致），两种适配器都适用。此决定可逆——真测出 HTTP 是瓶颈，换 Fastify 仅改 bootstrap 一行；下沉到原生 `req/res` 的地方（如 `.sqlite` 流式下载）优先用 Nest 平台无关的 `StreamableFile`，保持可移植。

### 4.2 ORM：Drizzle

- **选 Drizzle 而非 Prisma/TypeORM**：TS-first、贴近原生 SQL、类型安全、内置 migration。你现状是手写 SQL，Drizzle 迁移阻力最小（保持"看得见 SQL"的心智），且支持 `FOR UPDATE SKIP LOCKED`、`jsonb`、`pgEnum`。
- Prisma 次选（DX 好但更重、生成 client、SQL 控制弱）；TypeORM 是 Nest 默认但更笨重，不选。

### 4.3 工具链：nest CLI + swc

- **问题**：Nest 依赖装饰器 + `reflect-metadata` 的 `emitDecoratorMetadata`，而现有 `tsx`（esbuild）**不支持**它。
- **方案**：dev/build 改用 `nest start --watch --builder swc`（swc 原生支持 decorator metadata、快）；`tsconfig` 开 `experimentalDecorators` + `emitDecoratorMetadata`；入口 `import 'reflect-metadata'`。**告别 `tsx watch`**。

### 4.4 schema 拆分与类型映射（SQLite → PG）

`packages/shared` 调整为：

- **保留** `DDL` / `TRIAGE_DDL`（SQLite 字符串）—— 供 mobile 建表 + server 导出 `.sqlite` 使用；
- **保留** 所有行类型 / zod schema（跨端共享，不动）；
- **新增** PG/Drizzle schema —— 放在 `apps/server`（server 专属，web 以只读复用类型即可），避免把 PG 依赖塞进跨端 shared 包。

类型映射决策：

| SQLite 现状                                                                                 | PG/Drizzle                                       | 说明                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 时间戳 `INTEGER`（Unix 秒：`created_utc` / `fetched_at` / `analyzed_at` …）                 | `bigint`（保持 Unix 秒，**不转 `timestamptz`**） | 保 mobile/export 兼容 + 行类型不变，零行为变更；将来想要 tz 再说                                                         |
| JSON `TEXT`（`insights.pain_points/opportunities/tags`、`triage.tags`、`sync_ops.payload`） | **`jsonb`**                                      | 兑现选 PG 的核心理由；(反)序列化收敛到 repository 边界——repo 返回已解析对象，**导出 `.sqlite` 时再 `stringify` 回 TEXT** |
| `intensity TEXT CHECK(...)`、`triage.status TEXT CHECK(...)`                                | `pgEnum`                                         | 原生枚举强约束                                                                                                           |
| `rating INTEGER CHECK(BETWEEN 1 AND 5)`                                                     | `integer` + `CHECK`                              | 保留范围约束                                                                                                             |
| `id INTEGER PRIMARY KEY AUTOINCREMENT`（insights/providers/jobs）                           | `generatedAlwaysAsIdentity()`                    |                                                                                                                          |
| `enabled INTEGER DEFAULT 1`                                                                 | `boolean`                                        |                                                                                                                          |
| `comments.post_id ... ON DELETE CASCADE`                                                    | 同语义 FK                                        |                                                                                                                          |

> ⚠️ `triage.tags` 现状是 JSON 字符串、`rowToTriage` 会 `JSON.parse`（[triage.ts](../packages/shared/src/triage.ts)）。改 `jsonb` 后 PG 侧返回已是数组——映射层要相应调整，而导出/同步与 mobile 仍按字符串走。

### 4.5 任务队列：`FOR UPDATE SKIP LOCKED`

现状 [jobs.ts](../apps/server/src/db/jobs.ts) 的 `claimNextJob` 靠 better-sqlite3 同步事务 + 单线程做原子认领。换 PG 后改写为：

```sql
SELECT * FROM analysis_jobs WHERE status='queued'
ORDER BY enqueued_at, id FOR UPDATE SKIP LOCKED LIMIT 1;
-- 同事务内 UPDATE ... SET status='running', ...
```

这同时**解锁"worker 独立成进程/多进程"**——多个消费者并发认领不冲突。心跳/僵死回收/`max_attempts` 逻辑原样保留。

### 4.6 导出路径保留 SQLite 产出

[export/batch.ts](../apps/server/src/export/batch.ts) 的 `writeBatchSqlite` **继续用 better-sqlite3 写出 `.sqlite` 文件**，仅把数据源从"读 live SQLite"改为"读 PG"。mobile 的 `ATTACH` 合并依赖此格式，必须保。

### 4.7 web 读取方式：直连 PG 只读

- **选直连 PG（只读角色）**：保留现有 RSC 直查模式（[queries.ts](../apps/web/src/lib/queries.ts) 全 SELECT），改动最小，PG 的并发读正是强项。给 web 一个 `readonly` 数据库角色。
- 备选（不选）：所有读经 server HTTP——要为 ~15 个查询造 API、加延迟。

---

## 5. 分阶段实施

> 推进方式：在 `refactor/nest-pg` 分支上按检查点演进；这是单机/局域网工具，**不需要生产灰度/双写**。每个阶段的退出标准 = 该切片能编译、类型检查过、关键路径可针对 PG 验证。最危险的 async 改造（Phase 2）单独隔离，避免与框架改造混在一起难以归因。

### Phase 0 — 脚手架与工具链（S）

- Nest 骨架在 `apps/server` 内**与旧代码并存**（先不删旧入口）；接通默认 Express 适配器、`nestjs-pino`、`@nestjs/config`（把现有 [env.ts](../apps/server/src/config/env.ts) 的 zod 校验作为 `validate` 注入）。
- `docker-compose` 起本地 Postgres；装 Drizzle + drizzle-kit。
- 工具链切到 nest CLI + swc；tsconfig 开装饰器元数据。
- **退出**：`nest start` 启动、`GET /api/health` 返回；PG 可连；旧入口仍可跑。

### Phase 1 — Drizzle PG schema + 迁移（M）

- 按 §4.4 把全部表建模为 Drizzle PG schema：`posts` / `comments` / `insights` / `triage` + server 专属 `sync_ops` / `model_providers` / `app_settings` / `analysis_jobs`。
- drizzle-kit 生成并应用 migration（事务性 DDL）。
- **退出**：`drizzle-kit migrate` 一把建出完整 PG schema；类型与 shared 行类型对齐。

### Phase 2 — 数据层 sync→async repositories（L，关键路径/最高风险）

- 把 [db/](../apps/server/src/db) 各文件（`posts`/`comments`/`insights`/`jobs`/`providers`/`settings`/`utils`）改写为 **Nest 可注入的异步 repository（Drizzle）**；连带 [sync/apply.ts](../apps/server/src/sync/apply.ts)、[export/batch.ts](../apps/server/src/export/batch.ts) 的数据读取改异步。
- 队列认领改 `FOR UPDATE SKIP LOCKED`（§4.5）。
- **新增测试**（Nest TestingModule）：①队列并发认领不重复 ②sync 按 `op_id` 幂等 ——这两条是正确性核心。
- ⚠️ async 涟漪会从 db 层传染到所有调用者；保证"读-改-写"包在单个事务里，别被 `await` 切开。
- **退出**：全部数据访问异步 + Drizzle 类型化；并发/幂等测试通过。

### Phase 3 — HTTP → Nest Controllers（M）

- 把 [http.ts](../apps/server/src/server/http.ts) 的端点逐个迁为 Controller + DTO（`nestjs-zod` 复用现有 zod）+ BearerAuth Guard + bodyLimit + 全局异常过滤；`.sqlite` 下载用流式响应。
- **路由与请求/响应结构保持字节级不变**（mobile + web 依赖）。
- **新增契约测试**：每个端点 in/out 与旧实现一致。
- **退出**：端点行为一致；旧 `http.ts` 退役。

### Phase 4 — 调度与 worker 进框架 + 拆进程（M）

- cron 迁 `@nestjs/schedule` 的 `@Cron`，**保留 [scheduler.ts](../apps/server/src/scheduler.ts) 的 `guard()` 非重入逻辑**（框架不内置）。
- worker 池迁到生命周期钩子（`OnApplicationBootstrap` 起、`OnApplicationShutdown` 优雅排空），替掉 [index.ts](../apps/server/src/index.ts) 手写的信号监听。
- 借 PG 行锁把 worker 拆成**独立 Nest 应用进程**（standalone application context），与 HTTP 服务解耦、可独立扩。
- **退出**：scheduler + worker 在 Nest 下运行；worker 可作为单独进程消费同一 PG 队列。

### Phase 5 — 导出路径适配 + CLI 收编（M）

- `export/batch.ts`：数据源改读 PG，**仍用 better-sqlite3 产出 `.sqlite`**（§4.6）；验证产物能被 mobile `ATTACH`。
- 把 CLI 一次性入口（[analyze-once.ts](../apps/server/src/analyze-once.ts) / [cli.ts](../apps/server/src/cli.ts) / [export-batch.ts](../apps/server/src/export-batch.ts)）改为 Nest 命令（`nestjs-commander`）或 HTTP 端点——**消除独立进程写库者**，回到字面意义单写者拓扑。
- **退出**：导出 `.sqlite` 仍兼容 mobile；无独立进程直接写 PG。

### Phase 6 — web 迁 PG 只读（M）

- `apps/web`：[db.ts](../apps/web/src/lib/db.ts) 的 `better-sqlite3 readonly` 换成 PG 只读连接；[queries.ts](../apps/web/src/lib/queries.ts) 全部 SELECT 用 Drizzle（或 `pg`）改写；从 web 移除 `better-sqlite3`。
- **退出**：web 从 PG 渲染，功能等价。

### Phase 7 — 数据迁移 + 切换 + 清理（M）

- 一次性迁移脚本：`radar.db`（SQLite）→ PG（见 §6）。
- 切换：删除 server 主存储侧的 better-sqlite3 用法（仅导出路径保留）、删除并存的旧入口与 [serve.ts](../apps/server/src/serve.ts) 等死代码。
- **退出**：生产以 Nest + PG 运行；server 主库为 PG，导出与 mobile 链路不变。

---

## 6. 数据迁移（Phase 7 细化）

- **搬运**：`posts` / `comments` / `insights` / `triage` / `model_providers` / `app_settings` 全量；`analysis_jobs` 可空库起步（队列是瞬态的）；`sync_ops` 视需要搬（幂等日志，可保留近期）。
- **转换**：JSON `TEXT` → `jsonb`（解析后写入）；时间戳整数原样；`enabled` 0/1 → boolean。
- **校验**：逐表行数比对；按 `id`/`post_id` 抽样字段比对；外键 + 唯一索引（`idx_insights_post` 等）在 PG 侧成立。
- **可回滚**：迁移前 `radar.db` 原件备份留存；切换失败直接回退分支 + 用回 SQLite 入口。

---

## 7. 风险与回滚

| 风险                             | 影响                 | 缓解                                                     | 回滚                   |
| -------------------------------- | -------------------- | -------------------------------------------------------- | ---------------------- |
| async 涟漪范围大（~97 SQL 触点） | 改动面广、易漏 await | Phase 2 单独隔离 + 类型检查兜底（漏 await 多为类型错误） | 分支隔离，未合并       |
| 队列并发认领正确性               | 重复分析/丢任务      | `SKIP LOCKED` + 并发单测                                 | 保留 attempts/回收兜底 |
| 导出 `.sqlite` 与 mobile 不兼容  | mobile 合并失败      | 保留 better-sqlite3 产出 + ATTACH 实测                   | 导出逻辑独立，可单独修 |
| HTTP 契约漂移                    | mobile/web 调用失败  | 契约测试 + 路由字节级保持                                | 端点逐个迁，旧的可暂留 |
| 工具链摩擦（装饰器元数据/ESM）   | 启动不起来           | Phase 0 先打通最小骨架再继续                             | —                      |
| 多养一个 PG 实例                 | 运维成本             | 本地 docker-compose；部署文档化                          | —                      |

---

## 8. 验证策略

- **每阶段**：`tsc --noEmit` + `nest build` 过。
- **关键单测**：队列并发认领、sync 幂等（Phase 2）。
- **契约测试**：HTTP 端点 in/out 不变（Phase 3）；导出 `.sqlite` 可被 mobile `ATTACH`（Phase 5）。
- **性能验证（兑现并发收益）**：用 `autocannon`/`k6` 模拟"N 个并发请求 + 后台定时器在写"，对比迁移前后的 p95/p99 与吞吐——预期看到 SQLite 版尾延迟随并发陡升、PG 版基本走平（这正是换库的唯一性能理由，要量出来）。

---

## 9. 工作量与里程碑（相对体量）

| Phase                     | 体量  | 关键路径                                  |
| ------------------------- | ----- | ----------------------------------------- |
| 0 脚手架/工具链           | S     | 解决装饰器元数据后即顺                    |
| 1 Drizzle schema          | M     |                                           |
| **2 数据层 async + 队列** | **L** | **最大块、最高风险，建议留足时间 + 测试** |
| 3 HTTP→Controller         | M     |                                           |
| 4 scheduler/worker        | M     |                                           |
| 5 导出/CLI                | M     | mobile 兼容验证是硬关卡                   |
| 6 web 迁 PG               | M     |                                           |
| 7 数据迁移/切换           | M     |                                           |

不给绝对工时（取决于投入节奏）；**关键路径是 Phase 2**，其余阶段相互依赖较松，可按上面顺序串行推进。

---

## 附：执行顺序的取舍说明

为什么**不先"Nest-on-SQLite"再单独换库**？因为既然 DB 也要换，最省的是**在 Phase 2 把数据层一次性改成"异步 Drizzle repository"**，而不是先把同步 better-sqlite3 包进 Nest provider、之后再回来改异步——那样数据层要动两遍。本计划让 async 改造搭着框架化的车一次做完。
