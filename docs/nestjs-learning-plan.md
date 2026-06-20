# NestJS 学习计划（Midway 老手 · 围绕 hatch-radar）

> 给有 Midway.js 经验的人的 NestJS 上手计划：**以 `apps/api`（控制面）+ `apps/worker`（数据面）的真实代码为教材**，每个里程碑都落到本仓已有代码（读）或真·未建增量（建）。
> Midway 与 NestJS 是概念上的孪生（IoC、装饰器、Guard/Filter/Pipe、生命周期几乎照搬），所以本计划不从零讲框架，而是聚焦**「Midway 会的直接迁移、真正不同的重点学」**。

- **状态**：活文档（边学边勾 ☐/☑）
- **日期**：2026-06-20（按当前仓库结构彻底重整一版）
- **前提**：已掌握 Midway 的 IoC/DI、装饰器路由、Guard/Filter/Pipe、生命周期、配置体系
- **教材**：`apps/api`（NestExpress 控制面，单实例）+ `apps/worker`（standalone context 数据面，可多开）+ 八个能力包 `packages/*`（NestJS 11 + Express + Prisma 7）
- **官方文档**：<https://docs.nestjs.com>（下文「资料」列章节名）

### 现状校准（这版重整的依据）

自上一版以来仓库结构变化很大，本计划按现状全量对齐过路径与示例：

1. **后端拆成恒两进程**：`apps/server` 已拆为 `apps/api`（控制面）+ `apps/worker`（独立 pnpm 包，数据面）。原 `core` 已拆成 `kernel` / `db` / `crawler` / `analysis` 四个框架无关能力包（另有 `auth` / `shared` / `config` / `ui`）。
2. **api 内部多了一层「领域层」**：`apps/api/src/domain/*` 是框架无关的领域服务，由 `domain/assembly.ts` 的 `createCore()` 一处装配；`apps/api/src/<feature>/*` 只剩 Nest 薄壳（控制器 / 守卫 / 生命周期 starter）。**这是本仓最重要的新结构，独立成 [§2](#2-本仓三层架构先建立这张地图)。**
3. **执行模型换代**：旧 `analysis_jobs` / `job_steps` 已迁为 `blueprints → runs → tasks → task_stages`；「流水线检视器」升格为 **worker 的通用任务执行内核**（`WorkerService.runTask`，6 节点 `resolve→fetch→context→ai_call→normalize→persist` 通用化为 task_stages）。M5 据此重写。
4. **web 退为纯前端**：`apps/web` 现为 Vite SPA，**零 PG、零鉴权逻辑**。上一版引用的 `apps/web/src/lib/auth/guards.ts`、`audit.ts` 已不存在——鉴权与审计现在**全在服务端**。capstone 据此重写。
5. **运行期配置中心 + 账户 RBAC 两大块仍稳定落地、带测试**——故主线仍以「精读真实实现 + 做小而真的增量」为主，实战靶子仍是**审计 Interceptor**（已核实：全仓至今无任何 Interceptor）。

---

## 0. 怎么用这份计划

- **先读 [§2 三层架构](#2-本仓三层架构先建立这张地图)**——这是读懂本仓任何一段代码的地图，也恰好是 Midway 老手最需要重学的「模块边界 / provider 可见性」的活样本。
- **M0–M2 按顺序打地基**（环境心智 → DI/模块 → 请求生命周期/横切）。这三块是 Midway 老手唯一需要认真重学的部分，约占总学习量的 70%。
- **M3–M6 可与实战主线交叉做**（配置/数据层/异步/测试），边学边落到 [§5](#5-实战主线capstone) 的 capstone。
- **M7 是参考版图**，本项目没用到、但 NestJS 生态里该知道的，按需查。
- 每个里程碑统一四件套：**学习目标 · 读这些代码 · 动手 · Midway 对照 & 坑**。
- 全程开着 [§6 坑清单](#6-midway-老手坑清单cheat-sheet) 对照——那些是 Midway 直觉会踩的。

---

## 1. Midway → NestJS 迁移地图（先看这张表）

你已经会的，绝大多数能平移。下表第 4 列「关键差异」才是要花时间的地方。

| 维度          | Midway.js                                          | NestJS                                                                                      | 关键差异（要重学的）                                                                                      |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| IoC 容器      | `@midwayjs/core`，reflect-metadata                 | 内置，reflect-metadata                                                                      | 机理一致                                                                                                  |
| 可注入声明    | `@Provide()` / 自动扫描，**装了就全局可注入**      | `@Injectable()`，**必须挂到某 module 的 `providers`**                                       | ⭐ provider 有「模块归属」，不是全局池                                                                    |
| 注入方式      | `@Inject()`，**属性注入为主**                      | **构造注入为主**，class 类型即 token                                                        | ⭐ 构造注入靠 `design:paramtypes` 元数据 → `import type` 会擦掉它（§6.1）                                 |
| 模块化        | `@Configuration({ imports, importConfigs })`       | `@Module({ imports, controllers, providers, exports })`                                     | ⭐⭐ **最大差异**：跨模块注入要 `exports` + 对方 `imports`，详见 M1                                       |
| 控制器/路由   | `@Controller` `@Get/@Post/@Put/@Del`               | 同名同义                                                                                    | 几乎一致                                                                                                  |
| 参数装饰器    | `@Body/@Query/@Param/@Headers`                     | 同名同义                                                                                    | 一致；自定义用 `createParamDecorator`（本仓 `@AuthUser`/`@DeviceUser`）                                   |
| 中间件        | `implements IMiddleware`                           | `implements NestMiddleware` + 在 module 的 `configure()` 里 apply                           | 注册位置不同（在模块里 `forRoutes`）                                                                      |
| 守卫 Guard    | `implements IGuard`                                | `implements CanActivate`                                                                    | 一致；Nest 用 `ExecutionContext` + `Reflector` 读元数据                                                   |
| 管道/校验     | `@Valid` + `PipeTransform`                         | `PipeTransform`（全局或路由级）                                                             | 一致（本仓用 Zod 自定义 Pipe，非 class-validator）                                                        |
| 过滤器 Filter | `@Catch` + `IFilter`                               | `@Catch` + `ExceptionFilter`                                                                | 一致（本仓 `AllExceptionsFilter`）                                                                        |
| AOP / 拦截    | `@Aspect` + `IMethodAspect`（around/before/after） | **无 AOP**；用 **Interceptor**（返回 **RxJS Observable**）                                  | ⭐ Interceptor 是 Observable 流式包裹，不是 around 函数（§6.6）；本仓**至今没用过**，正好当 capstone 靶子 |
| 生命周期      | `@Init` / `onReady` / `onStop`                     | `OnModuleInit`/`OnApplicationBootstrap`/`BeforeApplicationShutdown`/`OnApplicationShutdown` | 名字不同，时机一一对应；本仓四个「starter」全在练这个（M5）                                               |
| 配置          | `@Config('x')` + `config.{env}.ts` 自动合并        | `@nestjs/config`：`ConfigModule.forRoot` + `ConfigService.get`                              | ⭐ 配置是个要 `import` 的 module；本仓更进一步：Zod 校验产出强类型 `APP_ENV` 对象（M3）                   |
| 作用域 Scope  | `@Scope(ScopeEnum.Request)`                        | `Scope.REQUEST/TRANSIENT`                                                                   | 一致；但请求作用域会「传染」上游链（§6.8）；本仓全是默认单例                                              |
| 动态模块      | 组件 `importConfigs` / 组件配置                    | `forRoot()/forRootAsync()/registerAsync()`                                                  | ⭐ 形态不同（本仓 `StaticModule.forRoot()`），M3 专门练                                                   |
| 平台          | 默认 **Koa**（可 express/egg）                     | 默认 **Express**（可 Fastify）                                                              | `req/res` API 不同；`@Res()` 会接管响应（§6.9）                                                           |
| 启动入口      | `bootstrap`                                        | `NestFactory.create`（api）/ `createApplicationContext`（worker）                           | 思路一致；本仓两个进程各一个入口                                                                          |
| 定时/队列     | `@midwayjs/cron` / `@midwayjs/bull`                | `@nestjs/schedule` / `@nestjs/bullmq`                                                       | 一致思路；本仓 `@Cron` + **PG 表当队列**（非 BullMQ）                                                     |
| 测试          | `@midwayjs/mock` `createApp/close`                 | `@nestjs/testing` `Test.createTestingModule().compile()`                                    | Nest 可 `overrideProvider`，能力更强（M6）                                                                |

### 真正要重学的 5 件事（其余都能平移）

1. **模块边界 / provider 可见性**——Midway「装了就能注入」，Nest 必须 `exports` 出来 + 消费方 `imports` 进去。这是 Midway 老手第一个会卡的点（M1）。
2. **构造注入 + `import type` 杀 DI**——你们 memory 里已记的坑（[[server-nest-pg-refactor]]）。原因见 §6.1。
3. **自定义 provider 四件套**（`useClass/useValue/useFactory/useExisting`）+ Symbol/string **注入 token**——本仓用 `PRISMA`/`APP_ENV`/`CORE` 三个 Symbol token + `useFactory` 把整张「领域图」桥进 Nest（M1/M4）。
4. **Interceptor 是 RxJS Observable**——你熟的 `@Aspect` around 在这里换成「返回流」的写法（M2），且本仓**至今没用过**，正好当 §5 进阶靶子。
5. **动态模块 `forRoot(Async)`**——Midway 的组件配置换了形态（M3）。

---

## 2. 本仓三层架构（先建立这张地图）

读任何一段后端代码前，先认清它落在哪一层。这套分层本身就是 NestJS「模块边界 + 自定义 provider」的活教材——把它吃透，M1 就过了一大半。

```
┌─────────────────────────────────────────────────────────────────────┐
│  ① 能力包  packages/*   —— 框架无关，api 与 worker 共用，零 Nest 依赖   │
│     kernel(基座/logger/crypto/协议)  db(唯一 PG 读写层:Prisma+仓储)     │
│     crawler(采集)  analysis(AI+翻译)  auth(口令/会话/Ed25519)           │
│     shared(跨端类型+权限目录)  config(共享配置)  ui(shadcn,仅PC)        │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ 被下面两个 app 各自 import
        ┌────────────────────────┴────────────────────────┐
        ▼                                                  ▼
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│  apps/api（控制面 · NestExpress） │      │  apps/worker（数据面 · standalone）│
│                                  │      │                                  │
│  ② 领域层 src/domain/*           │      │  ② 领域装配 src/assembly.ts       │
│     框架无关的 api 自有服务:      │      │     createWorkerCore(db) → 最小   │
│     account/admin/data/sync/     │      │     依赖图（仓储+分析+采集+gate） │
│     export/gateway/pipeline/     │      │                                  │
│     scheduler/seed/auth          │      │  ③ Nest 薄壳                      │
│     + assembly.ts: createCore()  │      │     worker.module.ts（自建PRISMA）│
│       一处把①②装配成一张图       │      │     worker.starter.ts（生命周期） │
│                                  │      │     worker.service.ts（执行内核） │
│  ③ Nest 薄壳 src/<feature>/*     │      │     worker-agent.ts（WS连api网关）│
│     控制器 / 守卫 / *.module.ts  │      └──────────────────────────────────┘
│     生命周期 starter（见下）      │
│     core.module.ts: fromCore     │         两进程经 PostgreSQL 队列
│       把②的每个实例按「其类」    │◄───────（tasks/task_stages）+ WS 网关
│       登记为 Nest provider       │         解耦；唯一共享是 ① 能力包
└──────────────────────────────────┘
```

**桥接是怎么做的（M1 的核心范例）**：`apps/api/src/core/core.module.ts` 里，`CORE` 工厂调 `createCore(PRISMA, APP_ENV)` 装配出整张领域图，再用 `fromCore(SomeClass, 'key')` 把每个实例**以「它的类」为 DI 令牌**重新登记为 Nest provider（`useFactory: (core) => core[key], inject: [CORE]`）。效果：控制器照常按类型构造注入（`constructor(private posts: PostsRepository)`），零改注入点，而领域层完全不知道 Nest 的存在。这是 `useFactory` 高级用法的教科书示例。

**「领域服务 + Nest 薄壳 starter」是贯穿全仓的模式**——凡是有生命周期 / 后台循环的关注点，都拆成「框架无关的领域服务（在 `domain/`）+ 一个只挂生命周期钩子、把活委托下去的 Nest 类（在 `<feature>/`）」：

| 关注点      | 框架无关领域服务                        | Nest 薄壳（挂生命周期/装饰器）                                                             |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| 定时调度    | `domain/scheduler/scheduler.service.ts` | `scheduler/scheduler.cron.ts`（`@Cron` + `OnApplicationBootstrap`）                        |
| WS 推送网关 | `domain/gateway/gateway.service.ts`     | `gateway/gateway.starter.ts`（`OnApplicationBootstrap` + **`BeforeApplicationShutdown`**） |
| 首启播种    | `domain/seed/seed.runner.ts`            | `seed/seed.hook.ts`（`OnApplicationBootstrap`）                                            |
| worker 执行 | `worker.service.ts` 的 `start()/stop()` | `worker.starter.ts`（`OnApplicationBootstrap` + `OnApplicationShutdown`）                  |

**为什么这么分**：① 领域层可被纯函数式单测、可被 api 与 worker 两进程复用；② Nest 只负责 HTTP / DI 装配 / 生命周期；③ 因为注入靠「类当 token」，所以 `import type` 杀 DI 这条坑（§6.1）在这里尤其致命——`fromCore` 登记的全是值。

> 一句话记忆：**`packages/*` 是能力，`domain/*` 是把能力组织成业务，`<feature>/*` 是把业务接进 Nest 的 HTTP / 生命周期。**

---

## 3. 里程碑总览

| 里程碑                        | 学什么                                            | 读这些代码（本仓现成）                                                                     | 动手产出                                  |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **M0** 环境与心智             | 启动链路、reflect-metadata、两种入口、swc 跑源    | `apps/api/src/main.ts`、`apps/worker/src/main.ts`、`apps/api/package.json`                 | 本地跑起 api+worker，跟一遍启动顺序       |
| **M1** DI 与模块系统 ⭐       | provider 可见性、自定义 provider、token、桥接     | `app.module.ts`、`database.module.ts`、`tokens.ts`、`domain/assembly.ts`、`core.module.ts` | 画 DI 依赖图；故意 `import type` 复现报错 |
| **M2** 请求生命周期 / 横切 ⭐ | Guard/Pipe/Filter/Interceptor、Reflector 元数据   | 两对「守卫+装饰器」、`zod-validation.pipe.ts`、`http-exception.filter.ts`                  | 写一个 LoggingInterceptor（本仓缺的那块） |
| **M3** 配置与动态模块         | `@nestjs/config`、Zod 强类型 env、`forRoot`       | `app-config.module.ts`、`config/env.ts`、`packages/kernel/src/env.ts`                      | 把某 boot 期注入改成动态模块              |
| **M4** 数据层（Prisma）       | PrismaService 模式、事务、仓储 DI、多 Key 转移    | `database.module.ts`、`client.ts`、`providers.repository.ts`、`key-failover.ts`            | 读懂多 Key 故障转移；仿写一个仓储         |
| **M5** 异步与长生命周期 ⭐    | 生命周期钩子、`@Cron`、独立上下文、网关、执行内核 | 四个 starter、`worker.service.ts`、`pipeline.service.ts`、`tasks.repository.ts`            | 写优雅停机测试；BullMQ vs PG 队列 ADR     |
| **M6** 测试                   | `Test.createTestingModule` + `overrideProvider`   | `provider-keys.spec.ts`、`settings-controller.spec.ts`、`task-kernel.spec.ts`              | 把一个手写测试改写成 testing module       |
| **M7** 超出本项目的版图       | 微服务/GraphQL/CQRS/Swagger/Passport…             | —（官方 sample）                                                                           | 各跑一个官方 sample                       |

---

## 4. 各里程碑详解

### M0 — 环境与心智模型对齐

**学习目标**：搞清 NestJS 在「不打包、跑 TS 源」这套非主流姿势下怎么启动；建立两种应用入口（HTTP app vs standalone context）的概念。

**读这些代码**

- [apps/api/src/main.ts](apps/api/src/main.ts) — `NestFactory.create<NestExpressApplication>()`、`useGlobalFilters(new AllExceptionsFilter())`、`setGlobalPrefix('api')`、`enableShutdownHooks()`、`useBodyParser`、nestjs-pino 注入；`listen(port, '0.0.0.0')` 同时供 web（同源）与 mobile（局域网）。
- [apps/worker/src/main.ts](apps/worker/src/main.ts) — `NestFactory.createApplicationContext()`（**无 HTTP 的独立上下文**）。注意 worker 是**真·独立 pnpm 包** `@hatch-radar/worker`，不是同一 app 内的第二入口；两进程共享同一 PG 队列协调工作。
- [apps/api/package.json](apps/api/package.json) — 看 `dev`/`start`：`node --env-file-if-exists=../../.env --env-file-if-exists=.env [--watch] --import @swc-node/register/esm-register src/main.ts`。**本仓不走 `nest build` / nest CLI**，而是 swc 直接跑 TS 源；env 分两层（根 `.env` + app 本地 `.env`，app 覆盖根，见 [[env-example-required-uncommented]]）；`dev`/`start` 启动前先 `prisma migrate deploy`。
- [apps/api/tsconfig.json](apps/api/tsconfig.json) — 确认 `experimentalDecorators` + `emitDecoratorMetadata`（DI 的命根子）。

**动手**

1. `pnpm dev:api` 跑起来，访问 `GET /api/health`（注意全局前缀 `api`）。
2. 另开一个终端 `pnpm dev:worker`，对比两个 bootstrap：api 建 HTTP server + 调度 + 网关，worker 只建 IoC 容器 + WS 连 api 网关认领任务。先确保 `docker compose up -d db`。
3. 在 `main.ts` 的 bootstrap 里打日志，观察 `enableShutdownHooks()` 后 Ctrl-C 的优雅停机顺序（为 M5 铺垫；留意 api 侧 `BeforeApplicationShutdown → dispose → OnApplicationShutdown` 的次序）。

**Midway 对照 & 坑**

- Midway 默认 Koa，本仓是 **Express adapter**（`NestExpressApplication`）——`req/res` 是 Express 的。
- `import 'reflect-metadata'` 必须在最顶（`main.ts` 两个入口、测试 `test/setup.ts` 都做了）。
- 资料：docs.nestjs.com → _First steps_、_Standalone applications_。

---

### M1 — DI 与模块系统 ⭐（Midway 老手的重灾区）

**学习目标**：吃透「provider 不是全局池，而是有模块边界的」这件事——这是你从 Midway 过来唯一真正陌生的核心机制。再看懂本仓如何用 `useFactory` 把整张框架无关的领域图桥进 Nest DI（[§2](#2-本仓三层架构先建立这张地图) 的桥接细节）。

**读这些代码**

- [apps/api/src/app.module.ts](apps/api/src/app.module.ts) — 根模块，看 `imports` 里哪些是 `@Global`（Config/Database/Core）、哪些是普通特性模块，以及为何 `SeedModule` 必须排在 `SchedulerModule` 之前。
- [apps/api/src/config/app-config.module.ts](apps/api/src/config/app-config.module.ts) — `@Global()` + `ConfigModule.forRoot({ validate })` + `useFactory` 提供 `APP_ENV` 并 `exports`。
- [apps/api/src/database/database.module.ts](apps/api/src/database/database.module.ts) — `DB_HANDLE → PRISMA` 的 `useFactory` + `inject` 链（**自定义 provider 的范本**），并用 `DatabaseLifecycle`（`OnModuleInit` 探活 / `OnApplicationShutdown` 断连）管连接。
- [apps/api/src/common/tokens.ts](apps/api/src/common/tokens.ts) — `APP_ENV`/`PRISMA`/`CORE` 三个 **Symbol token**；注释解释了「token 单独成文件」为何能避免单测被迫拖入 config/dotenv 依赖链。
- [apps/api/src/domain/assembly.ts](apps/api/src/domain/assembly.ts) — ⭐ **`createCore(db, env)`**：在 NestJS 之外一次性 `new` 出全部仓储 + 服务 + 调度 + 网关 + 种子，依赖图只在此定义一次。框架无关。
- [apps/api/src/core/core.module.ts](apps/api/src/core/core.module.ts) — ⭐ **本仓最值得精读的 DI 范本**。`fromCore(ClassName, 'key')` 把 `createCore` 产物的每个实例以「其类」为 token 登记为 provider（`useFactory: (core) => core[key], inject: [CORE]`）。配合 `@Global()`，控制器维持按类型构造注入、零改注入点。
- [apps/api/src/domain/index.ts](apps/api/src/domain/index.ts) — 领域桶：把能力包（kernel/db/crawler/analysis/auth）与 api 自有领域服务汇成单一入口 `@/domain`，控制器 / 守卫 / starter / CoreModule 统一从这里导入。

**动手**

1. **画 DI 依赖图**：从 `AppModule` 出发，画出 `imports` 树 + 每个 provider 被谁注入。重点标注「哪些 provider 因为在 `@Global` 模块（Config/DB/Core）所以到处能用」。
2. **复现核心报错**：把某个被注入的 service 改成 `import type { XxxService }`，启动看 `Nest can't resolve dependencies of ...`——这就是你们 memory 记的坑，亲手踩一次记得牢（§6.1）。
3. **体会模块边界**：临时把 `DatabaseModule` 的 `@Global()` 去掉，启动会炸；再改成「在需要 `PRISMA` 的模块里显式 `imports: [DatabaseModule]`」让它复活——这就是 Midway 没有的「可见性」机制。
4. 用四种自定义 provider 各写一个玩具 provider：`useValue`（常量）、`useClass`（换实现）、`useFactory`（带 `inject`）、`useExisting`（别名）。
5. **对比两侧装配**：精读 `core.module.ts` 的 `fromCore` 后，到 [apps/worker/src/assembly.ts](apps/worker/src/assembly.ts)（`createWorkerCore`）和 [apps/worker/src/worker.module.ts](apps/worker/src/worker.module.ts) 看 worker 怎么用**更薄**的方式装配（只 `new` 认领循环所需的最小依赖图，`WorkerService` 直接以 `useFactory` 登记，无 `CORE` 大图）。对比两侧取舍。

**Midway 对照 & 坑**

- Midway `@Provide` 自动扫描 = 全局可注入；Nest 默认**只在本模块可见**，要 `exports` + `imports` 才能跨模块。`@Global()` 是「我懒得到处 import」的逃生舱，但代价是隐式耦合、难测——本仓只给 Config/DB/Core 这种「天生全局单例」用，别滥用（§6.3）。
- class 作 token 是默认；当你要注入「接口/工厂结果/第三方实例」（如 `AppEnv`/`AppDatabase`/整张 `Core`）时，用 Symbol token + `@Inject(TOKEN)`。
- 循环依赖：要么 `forwardRef()`，要么像本仓一样**把 token 抽到 `tokens.ts`** 打破 import 环。
- 资料：docs.nestjs.com → _Providers_、_Modules_、_Fundamentals/Custom providers_、_Fundamentals/Injection scopes_。

---

### M2 — 请求生命周期与横切关注点 ⭐（账户 RBAC + 审计 Interceptor 全靠这套）

**学习目标**：掌握 Nest 的请求处理管线和五种横切组件，尤其是 **Reflector + `SetMetadata` 元数据驱动**——这是本仓 RBAC 与 [§5](#5-实战主线capstone) 审计 Interceptor 的核心机制。本仓有**两对平行的「守卫 + 能力装饰器」**，正好对照学。

**执行顺序（背下来）**：

```
请求 → 中间件 Middleware → 守卫 Guard → 拦截器 Interceptor(前)
     → 管道 Pipe → 处理器 Handler
     → 拦截器 Interceptor(后) → 异常过滤器 Exception Filter → 响应
```

**读这些代码**

- [apps/api/src/account/session-auth.guard.ts](apps/api/src/account/session-auth.guard.ts) — 会话守卫（所有 web 面向端点）：CSRF 头 → httpOnly cookie → `AccountService.resolveSession` → `Reflector.getAllAndOverride(REQUIRE_PERMISSION, ...)` 做能力闸。**最该先读的那个。**
- [apps/api/src/account/auth-user.decorator.ts](apps/api/src/account/auth-user.decorator.ts) — 会话侧装饰器对：`@RequirePermission(key)`（`SetMetadata`）+ `@AuthUser()`（`createParamDecorator` 取 `req.user`）。
- [apps/api/src/auth/device-or-session.guard.ts](apps/api/src/auth/device-or-session.guard.ts) — **进阶范本**：**双通道**（mobile 设备 Ed25519 **或** web 会话）+ `ExecutionContext` + `Reflector` 读元数据，两通道共用同一能力 key、都 fail-closed。
- [apps/api/src/auth/device-permission.decorator.ts](apps/api/src/auth/device-permission.decorator.ts) — 设备侧装饰器对：`@RequireDevicePermission(key)` + `@DeviceUser()`。**和会话侧那对结构同构——对照读，体会同一模式套两次。**
- [packages/shared/src/permissions.ts](packages/shared/src/permissions.ts) — 能力目录单一事实源（`PERMISSION_KEYS` / `PERMISSION_CATALOG` / `hasPermission`），两个守卫都调它；`super_admin` 隐式全通、停用即否。
- [apps/api/src/common/zod-validation.pipe.ts](apps/api/src/common/zod-validation.pipe.ts) — `PipeTransform`，用 Zod 校验 `@Body`。
- [apps/api/src/common/http-exception.filter.ts](apps/api/src/common/http-exception.filter.ts) — 全局 `@Catch()`（`AllExceptionsFilter`），统一 `{ error }` 契约、不泄露堆栈；由 `main.ts` 的 `useGlobalFilters` 注册。
- 看它们在 [apps/api/src/http/pipeline.controller.ts](apps/api/src/http/pipeline.controller.ts) / [apps/api/src/http/settings.controller.ts](apps/api/src/http/settings.controller.ts) 怎么用 `@UseGuards(SessionAuthGuard)` + `@RequirePermission('settings:manage')` + `@Body(new ZodValidationPipe(schema))`；以及 [apps/api/src/http/http.module.ts](apps/api/src/http/http.module.ts) 怎么靠 `imports: [AccountModule, AuthModule]` 让两套守卫可注入。

**动手**

1. **补上本仓缺的 Interceptor**：写一个 `LoggingInterceptor`，记录每个请求耗时（`intercept(ctx, next)` 里 `next.handle().pipe(tap(...))`）。这是练 **RxJS Observable 包裹** 的最佳入口（对照 Midway `@Aspect` 的 around），也是 §5 进阶 capstone（审计 Interceptor）的预热。
2. **脱稿重写一个守卫**：合上代码，凭 `permissions.ts` 的能力目录，自己重写 `session-auth.guard.ts`（或更难的双通道 `device-or-session.guard.ts`）的权限判定，再和仓库实现对拍。这是 §5 入门 capstone。
3. 把全局组件三种注册方式都试一遍：`app.useGlobalFilters(new Xxx())`（main.ts，**无法注入依赖**）、`@UseGuards()`（路由级）、`APP_GUARD`/`APP_INTERCEPTOR` provider（**能注入依赖**，§6.7）。

**Midway 对照 & 坑**

- Guard/Pipe/Filter 与 Midway 同名同位，无缝。
- **AOP 是最大不同**：Midway `@Aspect` 的 around 函数，在 Nest 里是 Interceptor 返回 `Observable`——忘了 `return next.handle()` 会**吞掉整个响应**（§6.6）。
- 全局 Pipe/Guard/Interceptor 若需注入依赖，**必须**用 `APP_PIPE`/`APP_GUARD`/`APP_INTERCEPTOR` provider 形式，不能用 `app.useGlobalXxx(new Xxx())`（后者 Nest 无法注入 DI，§6.7）。
- 资料：docs.nestjs.com → _Guards_、_Interceptors_、_Pipes_、_Exception filters_、_Custom route decorators_、_Fundamentals/Execution context_。

---

### M3 — 配置与动态模块（运行期配置中心正是这一套·已落地）

**学习目标**：理解 `@nestjs/config`，以及「带参数的可复用模块」= 动态模块 `forRoot(Async)`；看懂本仓「Zod 校验产出强类型配置对象」这个比官方默认更类型安全的范式，以及「保存即热重载、不重启进程」的运行期配置中心。

**读这些代码**

- [apps/api/src/config/app-config.module.ts](apps/api/src/config/app-config.module.ts) — `ConfigModule.forRoot({ isGlobal, cache, validate: () => loadEnv() })`：把 Zod 校验当 `validate` 注入；真正的强类型配置走 `APP_ENV` 的 `useFactory`。
- [apps/api/src/config/env.ts](apps/api/src/config/env.ts) — api 自有 env schema：`baseEnvShape`（来自 kernel）+ 控制面字段（`HTTP_PORT`/超管种子），`stripEmptyEnv`（空串当未设，[[env-example-required-uncommented]]），`.transform` 产出结构化 `AppEnv`。
- [packages/kernel/src/env.ts](packages/kernel/src/env.ts) — 共享基础字段 `baseEnvShape` + `parseEnv`（api 与 worker 各自拼自己的 schema，kernel 只留两端都读的部分）。对照 [apps/worker/src/env.ts](apps/worker/src/env.ts) 看 worker 怎么拼自己的网关/并发字段。
- 「热重载」线索：跟读 `reloadAnalysisConfig()` / bump `crawler_config_version`——「运行期可调配置入库、不重启生效」的 NestJS 落法（设置页改完下一轮即生效，含独立 worker 进程）。
- [apps/api/src/static/static.module.ts](apps/api/src/static/static.module.ts) — `StaticModule.forRoot()`：本仓现成的**动态模块**写法（同源托管 web SPA），M3 动手#1 的对照样本。

**动手**

1. 挑一个现在 boot 期固定注入的东西，改造成 `forRootAsync`（用 `useFactory` + `inject: [APP_ENV]` 异步装配），体会动态模块与静态模块的差别；和 `StaticModule.forRoot()` 对照。
2. 读 `ConfigurableModuleBuilder`（官方动态模块脚手架），理解它替你生成 `forRoot/forRootAsync` 的样板。
3. 想清楚：本仓为何**没**用 `ConfigService.get('FOO')` 这种 stringly-typed 取值，而是 `@Inject(APP_ENV)` 拿强类型对象——这是个值得学的「比官方默认更类型安全」的范式。

**Midway 对照 & 坑**

- Midway `@Config('x')` + `config.{env}.ts` 自动合并；Nest 没有「凭空 @Config」，配置是个要 `import` 的 module，再注入 `ConfigService`（或像本仓注入自定义的 `APP_ENV`）。
- `forRoot`（同步配置）vs `forRootAsync`（依赖别的 provider 才能装配，如「连接串来自 ConfigService」）——分清用哪个。
- 资料：docs.nestjs.com → _Techniques/Configuration_、_Fundamentals/Dynamic modules_、_Fundamentals/Async providers_。

---

### M4 — 数据层：Prisma 接入与仓储（读已落地的多 Key 故障转移）

**学习目标**：掌握 Prisma 在 Nest 里的两种接法、事务、仓储模式 DI，并把已落地的「多 Key 故障转移」当范本读透。

**读这些代码**

- [apps/api/src/database/database.module.ts](apps/api/src/database/database.module.ts) — `DB_HANDLE → PRISMA` 的 `useFactory` 链 + `DatabaseLifecycle`（`OnModuleInit` 探活、`OnApplicationShutdown` 断连）。
- [packages/db/src/client.ts](packages/db/src/client.ts) + [packages/db/prisma.config.ts](packages/db/prisma.config.ts) — Prisma 7 **driver adapter**（`@prisma/adapter-pg`）、连接串不在 schema 里（[[server-nest-pg-refactor]] 记的坑）。
- [packages/db/src/mappers.ts](packages/db/src/mappers.ts) — `bigint ↔ number` 的 `toXxxRow` 映射（仓储读出后转域类型；Prisma 7 的 bigint 坑）。
- [packages/db/src/repositories/providers.repository.ts](packages/db/src/repositories/providers.repository.ts) — **已落地的多 Key 仓储**（框架无关类，经 `CoreModule` 的 `fromCore` 桥接注入 Nest）。
- [packages/analysis/src/analysis-config.service.ts](packages/analysis/src/analysis-config.service.ts) + [packages/analysis/src/key-failover.ts](packages/analysis/src/key-failover.ts) — `selectKey` + 单任务内故障转移 + 冷却自愈（`active/cooling/invalid` 状态机，分析与翻译**共用**这段）。
- 一个用事务的仓储，如 [packages/db/src/repositories/posts.repository.ts](packages/db/src/repositories/posts.repository.ts)（`db.$transaction`）。

**动手**

1. **读懂故障转移**：跟一遍「429→冷却该 Key→换下一把→全挂则任务失败」的链路。这是一段高质量的真实业务代码，比任何 demo 都值得精读。
2. 仿 `providers.repository.ts` 写一个新仓储（哪怕玩具表），走通「schema → `db:migrate:dev` → 生成类型 → 在 `createCore`/`createWorkerCore` 里 `new` → `fromCore` 登记 → 在某 controller 用」全链路。
3. 学官方 `PrismaService extends PrismaClient implements OnModuleInit` 的经典接法，对比本仓的 `useFactory + Symbol token + DatabaseLifecycle` 接法，理解两者取舍。

**Midway 对照 & 坑**

- Midway 接 Prisma/TypeORM 也是「包成可注入组件」，思路一致；差别只在 Nest 的 provider 注册方式。
- Prisma 7 坑（已在 [[server-nest-pg-refactor]] 记）：无 datasource url 走 `prisma.config.ts`、`bigint↔number` mapper、迁移走 CLI、`db push` 有 AI 同意闸。**改 schema 后必须 `db:migrate:dev` + 重启所有长驻进程**（api/worker 把生成的 client 载入内存）。
- 资料：docs.nestjs.com → _Recipes/Prisma_；Prisma 官方 7.x 文档。

---

### M5 — 异步与长生命周期 ⭐（四个 starter / 调度 / 网关 / 通用任务执行内核）

**学习目标**：掌握全套生命周期钩子、定时任务、独立应用上下文、WebSocket 网关，看懂[§2](#2-本仓三层架构先建立这张地图) 那四个「领域服务 + Nest starter」的真实落法，并能对「PG 队列 vs BullMQ」这类架构选型做判断。**这一站料最足。**

**读这些代码——先看四个 starter（生命周期钩子的集中教材）**

- [apps/api/src/scheduler/scheduler.cron.ts](apps/api/src/scheduler/scheduler.cron.ts) — `@Cron` + `OnApplicationBootstrap`（启动跑一轮初始化，不阻塞 HTTP），委托 [domain/scheduler/scheduler.service.ts](apps/api/src/domain/scheduler/scheduler.service.ts)（**业务逻辑在 api 领域层，不在 kernel**）；`ScheduleModule.forRoot()` 在 [scheduler.module.ts](apps/api/src/scheduler/scheduler.module.ts)，仅装入 api、worker 不含（不重复跑定时）。
- [apps/api/src/gateway/gateway.starter.ts](apps/api/src/gateway/gateway.starter.ts) — ⭐ **教科书级的关停顺序课**：用 `HttpAdapterHost` 取底层 `http.Server` 把 WS 网关挂上去，**关停挂在 `BeforeApplicationShutdown` 而非 `OnApplicationShutdown`**——注释讲清了为何（否则关 HTTP 等 WS、断 WS 等关 HTTP 死锁）。委托 [domain/gateway/gateway.service.ts](apps/api/src/domain/gateway/gateway.service.ts)。
- [apps/api/src/seed/seed.hook.ts](apps/api/src/seed/seed.hook.ts) — 最简 `OnApplicationBootstrap`：启动跑 `SeedRunner`（早于 scheduler 初始轮）。
- [apps/worker/src/worker.starter.ts](apps/worker/src/worker.starter.ts) — `OnApplicationBootstrap`（起 `WorkerService` + `WorkerAgentService` WS 连 api 网关）+ `OnApplicationShutdown`（停 agent、排空在途任务）。

**再看执行内核与队列**

- [apps/worker/src/worker.service.ts](apps/worker/src/worker.service.ts) — ⭐ **通用任务执行内核 `runTask`**：流水线检视器升格而来。一次认领只推进到下一个闸门；逐环节执行、每步落检查点（`task_stages.output`）；环节挂闸门则跑完置 `paused`、正常结束本次认领，靠放行（`paused→queued`）重认领续跑（「等待」交给持久层、worker 始终无状态）。含心跳、僵死回收（`start/stop`）、超时 + `AbortSignal`、6 节点 `resolve→fetch→context→ai_call→normalize→persist`（`ai_call` 是唯一不可重算节点，故必须落检查点）。
- [apps/api/src/domain/pipeline/pipeline.service.ts](apps/api/src/domain/pipeline/pipeline.service.ts) — 编排端：把自动分析派生成归属 `run`/`blueprint` 的 task；以 `GatewayService` 作派发器经 WS push 给 worker。
- [packages/db/src/repositories/tasks.repository.ts](packages/db/src/repositories/tasks.repository.ts) + [task-stages.repository.ts](packages/db/src/repositories/task-stages.repository.ts) + [runs.repository.ts](packages/db/src/repositories/runs.repository.ts) + [blueprints.repository.ts](packages/db/src/repositories/blueprints.repository.ts) — **PG 表当任务队列**（`FOR UPDATE SKIP LOCKED` 认领 + 状态机 + 部分唯一索引保幂等），新执行模型 `blueprints→runs→tasks→task_stages`（取代旧 `analysis_jobs`/`job_steps`），非 BullMQ。
- [apps/worker/src/request-gate.ts](apps/worker/src/request-gate.ts) + [apps/api/src/http/requests.controller.ts](apps/api/src/http/requests.controller.ts) — 全局出站请求闸（`request_queue`/`request_lanes`，单实例放行 + 翻页逐页入闸 + Web 可暂停），另一处长生命周期协调。

**动手**

1. 给 `worker.service.ts` 的优雅停机写一个测试：派任务 → 触发 shutdown → 断言在途任务被等完、不丢（参考 [apps/api/test/task-kernel.spec.ts](apps/api/test/task-kernel.spec.ts) 已有的跨 app 测法）。
2. **写一份 ADR**：「PG 队列 vs `@nestjs/bullmq`+Redis」。本仓选了 PG（无 Redis 依赖、持久、单实例 DB 锁协调 + push 网关）——把权衡写清楚（[[analyzer-redesign-plan]] 当初纠结过）。学 `@nestjs/bullmq` 的 `@Processor/@Process` 心智，知道什么场景该换。
3. 跑通官方 `@nestjs/schedule` 的 `@Interval`/`@Timeout`/动态 `SchedulerRegistry`，补足只用过 `@Cron` 的盲区。

**Midway 对照 & 坑**

- Midway 的 `onReady/onStop` ≈ Nest 的 `OnApplicationBootstrap/OnApplicationShutdown`；`@midwayjs/cron`、`@midwayjs/bull` 一一对应。
- `enableShutdownHooks()` 不开，`OnApplicationShutdown` 不会触发（M0 已见）；**关停顺序 `BeforeApplicationShutdown → dispose → OnApplicationShutdown`** 是 `gateway.starter.ts` 那节死锁课的关键。
- 单实例假设：api 侧 `@Cron` 用进程内非重入 guard 防并发——多实例部署会重复跑（设计声明单实例），这是要记住的约束；worker 才是可横向扩的那个。
- 可选注入：依赖在某进程不存在（如 worker 装配里 `AnalysisConfigService` 的 Dispatcher 留空）→ 设计上留可选，否则启动炸（§6.5）。
- 资料：docs.nestjs.com → _Techniques/Task scheduling_、_Techniques/Queues_、_Fundamentals/Lifecycle events_、_Standalone applications_、_WebSockets/Gateways_；设计稿 `docs/worker-push-gateway-design.md`、`docs/pipeline-inspector-design.md`、`docs/blueprint-lifecycle-design.md`。

---

### M6 — 测试（补上 `Test.createTestingModule`）

**学习目标**：学会 Nest 官方测试模块和 `overrideProvider`——本仓现在是「手动 `new` + 真库」，能跑但没用上 Nest 的 DI 测试能力，这正是你该补的差。

**读这些代码**

- [apps/api/test/settings-controller.spec.ts](apps/api/test/settings-controller.spec.ts) — 看现在怎么手动 `new SettingsController(...)` + stub 依赖（空桩 `{} as unknown as XxxService`）。
- [apps/api/test/provider-keys.spec.ts](apps/api/test/provider-keys.spec.ts) — 多 Key 故障转移的真实测试（配 M4 读）。
- [apps/api/test/task-kernel.spec.ts](apps/api/test/task-kernel.spec.ts) + [inspect.spec.ts](apps/api/test/inspect.spec.ts) + [request-gate.spec.ts](apps/api/test/request-gate.spec.ts) — 新执行内核 / 检视节点 / 请求闸的测试；注意 task-kernel 跨 app 引 `../../worker/src/worker.service`（PG 夹具在 api/test），是 M5 内核的活测法。
- [apps/api/vitest.config.ts](apps/api/vitest.config.ts) + [apps/api/test/setup.ts](apps/api/test/setup.ts) + [apps/api/test/helpers.ts](apps/api/test/helpers.ts) — `@` 别名、`import 'reflect-metadata'`、`fileParallelism: false`（共享单测试库 `hatch_radar_test`）、`setupTestDb`/`truncateAll` 夹具。

**动手**

1. 挑一个手写 `new` 的测试，**改写成** `Test.createTestingModule({...}).overrideProvider(PRISMA).useValue(fakeDb).compile()` 再 `moduleRef.get(Controller)`，对比两种风格的取舍（速度 vs 真实装配）。
2. 给 M2 写的 `LoggingInterceptor` / 重写的权限 Guard 写单测（`overrideProvider` mock 掉依赖）。
3. 学 e2e：`Test` + `supertest` 打真实 HTTP（`createNestApplication`），知道何时该用 e2e 而非单元。

**Midway 对照 & 坑**

- `@midwayjs/mock` 的 `createApp/close` ≈ Nest 的 `Test.createTestingModule().compile()` + `app.close()`，但 Nest 的 `overrideProvider/overrideGuard` 替换能力更细。
- vitest 跑 Nest 必须 `import 'reflect-metadata'`（本仓 `test/setup.ts` 已做），否则 DI 元数据为空。
- 跑测试前确保 `docker compose up -d db`（连真实 `hatch_radar_test`）。
- 资料：docs.nestjs.com → _Fundamentals/Testing_。

---

### M7 — 超出本项目的 NestJS 版图（知道有，按需深入）

本仓没用、但生态主流、面试/接活会遇到的。各跑一个官方 `sample/` 即可，不必现在深挖。

| 主题                   | 包                                                       | 何时需要 / 与本仓的关系                                                                                                |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Nest CLI + schematics  | `@nestjs/cli`                                            | `nest g module/controller/service` 脚手架、monorepo。本仓没用（swc 跑源）                                              |
| class-validator 校验   | `class-validator` + `ValidationPipe`                     | **生态默认**校验路线。本仓用 Zod——学它好理解别人的代码                                                                 |
| OpenAPI / Swagger      | `@nestjs/swagger`                                        | 自动生成 API 文档。本仓未引入——可作 §5 可选增量                                                                        |
| 认证 / 授权            | `@nestjs/passport` + JWT                                 | 主流 auth。**对照本仓手搓的会话/设备验签**——理解 account-rbac 为何不用 Passport（内网、设备密钥、零额外依赖）          |
| 微服务                 | `@nestjs/microservices`                                  | TCP/Redis/NATS/Kafka/gRPC/RabbitMQ 传输。本仓单体 + 手搓 WS 内部推送                                                   |
| GraphQL                | `@nestjs/graphql`                                        | 本仓纯 REST                                                                                                            |
| CQRS                   | `@nestjs/cqrs`                                           | 命令/查询/事件分离。本仓规模用不上                                                                                     |
| 限流 / 缓存 / 健康检查 | `@nestjs/throttler` / cache-manager / `@nestjs/terminus` | 本仓登录限流是手写落表、健康检查是手写 `/api/health`——terminus 可作 §5 可选增量                                        |
| Fastify adapter        | `@nestjs/platform-fastify`                               | 换更快的 HTTP 层。本仓用 Express                                                                                       |
| `@nestjs/websockets`   | Gateway 装饰器                                           | **本仓 WS 是手搓 `ws`**（`gateway.service.ts`），对照官方 `@WebSocketGateway` 理解为何手搓（共用 HTTP 端口、轻量推送） |

资料：docs.nestjs.com 对应章节；GitHub `nestjs/nest` 仓库的 `sample/` 目录有几十个可跑示例。

---

## 5. 实战主线（capstone）

> **现状校准（重要）**：本仓后端已相当成熟——**运行期配置中心**（多 Key 故障转移 + 数据源/连接器入库）与**账户 RBAC**（会话 + 设备验签 + 用户态 + 登录限流落表）**两大块都已落地、带测试**。schema 里 `users`/`user_permissions`/`sessions`/`device_credentials`/`audit_logs`/`login_attempts` 齐全；`packages/auth`、`packages/shared/permissions.ts` 都在。**注意 web 已退为纯前端**——鉴权与审计逻辑现在**全在服务端**（`apps/api/src/domain/*` + `apps/api/src/{account,auth}/*`），上一版 capstone 里的 `apps/web/src/lib/auth/*` 已不存在。
>
> 这对学习是**好事**：你有一份覆盖几乎所有 NestJS 模式的、真实且经测试的代码可精读。所以主线是 **「精读落地实现 + 做小而真的增量」**。

### 入门 capstone：精读并脱稿重写鉴权守卫（已落地）

- **性质**：纯读 + 在测试里重写，零风险，覆盖 M1+M2+M6。
- **做什么**：
  1. 逐段通读两套服务端鉴权：会话链路 [session-auth.guard.ts](apps/api/src/account/session-auth.guard.ts) + [auth-user.decorator.ts](apps/api/src/account/auth-user.decorator.ts)；双通道链路 [device-or-session.guard.ts](apps/api/src/auth/device-or-session.guard.ts) + [device-permission.decorator.ts](apps/api/src/auth/device-permission.decorator.ts) + [domain/auth/device-auth.service.ts](apps/api/src/domain/auth/device-auth.service.ts)；能力目录 [packages/shared/src/permissions.ts](packages/shared/src/permissions.ts) 与原语 `packages/auth/src`（scrypt/session/Ed25519）。
  2. **脱稿重写**：合上实现，凭授权语义 + 越权护栏自己写一遍 `DeviceOrSessionGuard`（双通道），再用 M6 的 `Test.createTestingModule` + `overrideProvider` 给它写测试，最后和仓库实现对拍。
- **练到的**：Guard + `ExecutionContext` + `Reflector` + `createParamDecorator` + 测试 module，把 M2 全套吃透。

### 进阶 capstone：审计 Interceptor（**全仓唯一没用过的横切模式**）⭐

- **性质**：**真·net-new**。本仓**至今没有任何 Interceptor**（已核实），而审计现在是**手动散写**——服务端逐处调 `auditLogs.write(...)`：[domain/auth/device-auth.service.ts](apps/api/src/domain/auth/device-auth.service.ts)、[domain/admin/admin.service.ts](apps/api/src/domain/admin/admin.service.ts)、[domain/account/account.service.ts](apps/api/src/domain/account/account.service.ts)、[http/translations.controller.ts](apps/api/src/http/translations.controller.ts)。把它收敛成一个声明式 Interceptor，正好兑现 runtime-config 那条「Key/凭据变更写 `audit_logs`」未来项。
- **做什么**：
  1. 写 `@Audit('analyze.run')` 元数据装饰器（`SetMetadata`，仿 `device-permission.decorator.ts`）。
  2. 写 `AuditInterceptor implements NestInterceptor`：`intercept(ctx, next)` 里用 `Reflector` 读 action，`next.handle().pipe(tap(() => writeAudit(...)))` 在处理成功后落 `audit_logs`，操作者从 `req.user`/`req.deviceUser` 解析。
  3. 以 `APP_INTERCEPTOR` provider 全局注册（**注意**：必须走 provider 形式才能注入 `AuditLogsRepository`，§6.7）。
  4. 把现有手动审计点改成 `@Audit(...)` 声明，删掉散落的调用。
- **练到的**：Interceptor（RxJS `tap`）+ `APP_INTERCEPTOR`（可注入依赖）+ `Reflector` 元数据 + Prisma 仓储——一次打通 M2 最难的一块和 M4。
- **验收**：敏感/计费端点自动落审计、操作者归属正确、有测试；手动审计调用清零。

### 还想多练？任选一个真·未建增量

- **多连接器故障转移**（schema 已支持未实现）——和已落地的「多 Key 故障转移」同构，照着 [providers.repository.ts](packages/db/src/repositories/providers.repository.ts) 抄到 [source-connectors.repository.ts](packages/db/src/repositories/source-connectors.repository.ts)。练 M4。
- **按源定制轮询频率** `sources.config.cadence`——调度按 cadence 分桶。练 M5（`SchedulerRegistry` 动态任务）。
- **把执行内核接到非 analyze 的 task kind**——`WorkerService.execStage` 已为 `discover`/`collect`/`recheck`/`translate` 留了分支，挑一个补全节点拆分。练 M5 的执行模型。
- **补 Swagger 或健康检查**（M7）——引 `@nestjs/swagger` 给现有 controller 出 OpenAPI，或 `@nestjs/terminus` 把手写 `/api/health` 升级成标准探针。

> 建议路径：**先读 [§2 三层架构] → 入门 capstone（精读+重写，3–5 天）→ 进阶 capstone 审计 Interceptor（主线，1–2 周）→ 任选增量**。M3–M6 的知识点在做这两条时自然补齐。

---

## 6. Midway 老手坑清单（cheat sheet）

按踩坑概率排序，前 3 个几乎必踩。

1. **`import type` 杀 DI** ⭐——构造注入靠 `emitDecoratorMetadata` 写入的 `design:paramtypes`；`import type { Foo }` 只保留类型、运行时把 import 擦掉，metadata 变 `Object`/`undefined`，报 `Nest can't resolve dependencies`。**注入用的类型一律普通 `import`**（[[server-nest-pg-refactor]] 已记）。本仓 `fromCore` 登记的全是值，尤其要小心。
2. **`Nest can't resolve dependencies of X (?)`** ⭐——最常见报错。`(?)` 那个位置的依赖没找到。99% 是：provider 没在某 module 的 `providers` 里，或没 `exports`，或消费方没 `imports` 提供方模块。学会读这个错就解决一半问题。
3. **`@Global()` 滥用**——Midway 直觉「装了就能用」会诱使你把什么都设 `@Global`。代价是隐式耦合、测试难隔离。只给「天生全局单例」（Config/DB/Core）用；业务模块老老实实 `exports`+`imports`。
4. **循环依赖**——A 注入 B、B 注入 A → 用 `forwardRef(() => X)`，或像本仓把 token 抽到 `tokens.ts` 打破 import 环。
5. **可选注入**——依赖在某些进程不存在（如 worker 装配里 `GatewayService`/Dispatcher 留空）→ 用 `@Optional()` 或设计上留可空，否则启动炸。
6. **Interceptor 忘了 `return next.handle()`** ⭐——会**吞掉整个响应**（请求挂起）。Interceptor 是 RxJS 流，不是 Midway `@Aspect` 的 around；后置逻辑用 `.pipe(tap/map)`。做进阶 capstone 时直接撞这条。
7. **全局组件无法注入依赖**——`app.useGlobalGuards(new Xxx())` 里的 `Xxx` 拿不到 DI。需要依赖就改用 `APP_GUARD`/`APP_PIPE`/`APP_FILTER`/`APP_INTERCEPTOR` provider 形式注册。
8. **`Scope.REQUEST` 传染**——请求作用域的 provider 会让**所有依赖它的上游**也变请求作用域，每请求重建、性能下降。非必要不用；本仓全是默认单例。
9. **Express vs Koa**——本仓是 Express。`req/res` 是 Express 的；一旦用 `@Res()` 手动操作响应，Nest 的**自动序列化/拦截器后置就失效**了（除非 `passthrough: true`）。
10. **关停顺序死锁**——长连接（WS）必须在 `BeforeApplicationShutdown` 主动断开，拖到 `OnApplicationShutdown` 会与「dispose 关 HTTP 服务器」互等死锁（`gateway.starter.ts` 实战课）。
11. **测试缺 `reflect-metadata`**——vitest/jest 入口不 `import 'reflect-metadata'`，DI 元数据全空、装配失败（本仓 `test/setup.ts` 已处理）。

---

## 7. 资料清单

**官方（按里程碑顺序读）**

- docs.nestjs.com — _First steps_（M0）→ _Providers_ / _Modules_ / _Custom providers_ / _Injection scopes_（M1）→ _Guards_ / _Interceptors_ / _Pipes_ / _Exception filters_ / _Custom decorators_ / _Execution context_（M2）→ _Configuration_ / _Dynamic modules_（M3）→ _Recipes/Prisma_（M4）→ _Task scheduling_ / _Queues_ / _Lifecycle events_ / _Standalone applications_ / _Gateways_（M5）→ _Testing_（M6）。
- GitHub `nestjs/nest` 的 **`sample/`** 目录——几十个可跑示例，M7 各主题都有。
- 官方 **NestJS Fundamentals Course**（Trilon，付费）+ **Nest Devtools**（可视化模块/依赖图，正好帮你做 M1 的依赖图）。

**本仓配套设计稿**

- `docs/server-nest-postgres-refactor-plan.md` — 当初为何/如何迁到 NestJS（理解决策背景）。
- `docs/worker-push-gateway-design.md` — M5 网关部分。
- `docs/pipeline-inspector-design.md` + `docs/blueprint-lifecycle-design.md` — M5 通用任务执行内核 / `blueprints→runs→tasks→task_stages` 执行模型。
- `docs/seed-mechanism-design.md` — M5 种子。
- 仓库根 `CLAUDE.md` —— 架构 big picture 与关键约定/坑（与本计划 §2 互为印证）。

**对照 Midway**

- Midway 文档的「依赖注入 / 组件 / 生命周期 / Web 中间件守卫」章节，与本计划 §1 表逐项对照，能最快建立映射。

---

## 8. 进度勾选

- [ ] §2 三层架构（读懂地图——做后面一切的前提）
- [ ] M0 环境与心智
- [ ] M1 DI 与模块系统 ⭐
- [ ] M2 请求生命周期 / 横切 ⭐
- [ ] M3 配置与动态模块
- [ ] M4 数据层（Prisma）
- [ ] M5 异步与长生命周期 ⭐
- [ ] M6 测试
- [ ] M7 版图速览（选学）
- [ ] 入门 capstone：精读并脱稿重写鉴权守卫
- [ ] 进阶 capstone：审计 Interceptor（全仓首个 Interceptor）⭐
- [ ] （可选）真·未建增量：多连接器故障转移 / 按源 cadence / 执行内核接新 kind / Swagger·terminus
