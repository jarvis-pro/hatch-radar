# NestJS 学习计划（Midway 老手 · 围绕 hatch-radar）

> 给有 Midway.js 经验的人的 NestJS 上手计划：**以 `apps/api` + `apps/worker` 的真实代码为教材**，每个里程碑都落到本仓已有代码（读）或真·未建增量（建）。
> Midway 与 NestJS 是概念上的孪生（IoC、装饰器、Guard/Filter/Pipe、生命周期几乎照搬），所以本计划不从零讲框架，而是聚焦**「Midway 会的直接迁移、真正不同的重点学」**。

- **状态**：活文档（边学边勾 ☐/☑）
- **日期**：2026-06-15
- **前提**：已掌握 Midway 的 IoC/DI、装饰器路由、Guard/Filter/Pipe、生命周期、配置体系
- **教材**：`apps/api`（控制面）+ `apps/worker`（数据面）（NestJS 11 + Express + Prisma 7），配套设计文档 `docs/runtime-config-design.md`、`docs/account-rbac-design.md`、`docs/worker-push-gateway-design.md`、`docs/server-nest-postgres-refactor-plan.md`
- **官方文档**：<https://docs.nestjs.com>（下文「资料」列章节名）
- **现状校准**：运行期配置中心与账户 RBAC **两大块均已落地**（带测试）——本计划据此以「精读真实实现」为主，实战靶子改为少量真·未建增量（首选**审计 Interceptor**，全仓唯一没用过的横切模式），详见 §4。

---

## 0. 怎么用这份计划

- **M0–M2 按顺序打地基**（环境心智 → DI/模块 → 请求生命周期/横切）。这三块是 Midway 老手唯一需要认真重学的部分，约占总学习量的 70%。
- **M3–M6 可与实战主线交叉做**（配置/数据层/异步/测试），边学边落到 §4 的 capstone。
- **M7 是参考版图**，本项目没用到、但 NestJS 生态里该知道的，按需查。
- 每个里程碑统一四件套：**学习目标 · 读这些代码 · 动手 · Midway 对照 & 坑**。
- 全程开着 §5 的「坑清单」对照——那些是 Midway 直觉会踩的。

---

## 1. Midway → NestJS 迁移地图（先看这张表）

你已经会的，绝大多数能平移。下表第 4 列「关键差异」才是要花时间的地方。

| 维度          | Midway.js                                          | NestJS                                                                            | 关键差异（要重学的）                                                      |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| IoC 容器      | `@midwayjs/core`，reflect-metadata                 | 内置，reflect-metadata                                                            | 机理一致                                                                  |
| 可注入声明    | `@Provide()` / 自动扫描，**装了就全局可注入**      | `@Injectable()`，**必须挂到某 module 的 `providers`**                             | ⭐ provider 有「模块归属」，不是全局池                                    |
| 注入方式      | `@Inject()`，**属性注入为主**                      | **构造注入为主**，class 类型即 token                                              | ⭐ 构造注入靠 `design:paramtypes` 元数据 → `import type` 会擦掉它（§5.1） |
| 模块化        | `@Configuration({ imports, importConfigs })`       | `@Module({ imports, controllers, providers, exports })`                           | ⭐⭐ **最大差异**：跨模块注入要 `exports` + 对方 `imports`，详见 M1       |
| 控制器/路由   | `@Controller` `@Get/@Post/@Put/@Del`               | 同名同义                                                                          | 几乎一致                                                                  |
| 参数装饰器    | `@Body/@Query/@Param/@Headers`                     | 同名同义                                                                          | 一致；自定义用 `createParamDecorator`                                     |
| 中间件        | `implements IMiddleware`                           | `implements NestMiddleware` + 在 module 的 `configure()` 里 apply                 | 注册位置不同（在模块里 `forRoutes`）                                      |
| 守卫 Guard    | `implements IGuard`                                | `implements CanActivate`                                                          | 一致；Nest 用 `ExecutionContext` + `Reflector` 读元数据                   |
| 管道/校验     | `@Valid` + `PipeTransform`                         | `PipeTransform`（全局或路由级）                                                   | 一致（本仓用 Zod 自定义 Pipe，非 class-validator）                        |
| 过滤器 Filter | `@Catch` + `IFilter`                               | `@Catch` + `ExceptionFilter`                                                      | 一致                                                                      |
| AOP / 拦截    | `@Aspect` + `IMethodAspect`（around/before/after） | **无 AOP**；用 **Interceptor**（返回 **RxJS Observable**）                        | ⭐ Interceptor 是 Observable 流式包裹，不是 around 函数（§5.6）           |
| 生命周期      | `@Init` / `onReady` / `onStop`                     | `OnModuleInit`/`OnApplicationBootstrap`/`OnModuleDestroy`/`OnApplicationShutdown` | 名字不同，时机一一对应                                                    |
| 配置          | `@Config('x')` + `config.{env}.ts` 自动合并        | `@nestjs/config`：`ConfigModule.forRoot` + `ConfigService.get`                    | ⭐ 配置是个要 `import` 的 module，不是凭空 `@Config`                      |
| 作用域 Scope  | `@Scope(ScopeEnum.Request)`                        | `Scope.REQUEST/TRANSIENT`                                                         | 一致；但请求作用域会「传染」上游链（§5.8）                                |
| 动态模块      | 组件 `importConfigs` / 组件配置                    | `forRoot()/forRootAsync()/registerAsync()`                                        | ⭐ 形态不同，M3 专门练                                                    |
| 平台          | 默认 **Koa**（可 express/egg）                     | 默认 **Express**（可 Fastify）                                                    | `req/res` API 不同；`@Res()` 会接管响应（§5.9）                           |
| 启动入口      | `bootstrap`                                        | `NestFactory.create` / `createApplicationContext`                                 | 思路一致；本仓两个入口都有                                                |
| 定时/队列     | `@midwayjs/cron` / `@midwayjs/bull`                | `@nestjs/schedule` / `@nestjs/bullmq`                                             | 一致思路                                                                  |
| 测试          | `@midwayjs/mock` `createApp/close`                 | `@nestjs/testing` `Test.createTestingModule().compile()`                          | Nest 可 `overrideProvider`，能力更强（M6）                                |

### 真正要重学的 5 件事（其余都能平移）

1. **模块边界 / provider 可见性**——Midway「装了就能注入」，Nest 必须 `exports` 出来 + 消费方 `imports` 进去。这是 Midway 老手第一个会卡的点（M1）。
2. **构造注入 + `import type` 杀 DI**——你们 memory 里已记的坑（[[server-nest-pg-refactor]]）。原因见 §5.1。
3. **自定义 provider 四件套**（`useClass/useValue/useFactory/useExisting`）+ Symbol/string **注入 token**——本仓用 `PRISMA`/`APP_ENV` 两个 Symbol token + `useFactory` 接 Prisma（M1/M4）。
4. **Interceptor 是 RxJS Observable**——你熟的 `@Aspect` around 在这里换成「返回流」的写法（M2），且本仓**至今没用过**，正好当 §4 进阶靶子。
5. **动态模块 `forRoot(Async)`**——Midway 的组件配置换了形态（M3）。

---

## 2. 里程碑总览

| 里程碑                        | 学什么                                          | 读这些代码（本仓现成）                                                                  | 动手产出                                  | 关联路线图               |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------ |
| **M0** 环境与心智             | 启动链路、reflect-metadata、两种入口            | `main.ts`、`worker-main.ts`、`package.json`                                             | 本地跑起 server+worker，跟一遍启动顺序    | —                        |
| **M1** DI 与模块系统 ⭐       | provider 可见性、自定义 provider、token         | `app.module.ts`、`database.module.ts`、`tokens.ts`、`core.module.ts`（`fromCore` 桥接） | 画 DI 依赖图；故意 `import type` 复现报错 | 贯穿全局                 |
| **M2** 请求生命周期 / 横切 ⭐ | Guard/Pipe/Filter/Interceptor、Reflector        | `*.guard.ts`、`zod-validation.pipe.ts`、`*.filter`                                      | 写一个 LoggingInterceptor（本仓缺的那块） | 审计 Interceptor（§4）   |
| **M3** 配置与动态模块         | `@nestjs/config`、`forRootAsync`、热重载        | `app-config.module.ts`、`env.ts`                                                        | 把某 boot 期注入改成动态模块              | 运行期配置（已落地·读）  |
| **M4** 数据层（Prisma）       | PrismaService 模式、事务、仓储 DI、生命周期     | `database.module.ts`、`db/*.repository.ts`                                              | 读懂多 Key 故障转移；仿写一个仓储         | 运行期配置（已落地·读）  |
| **M5** 异步与长生命周期       | 生命周期钩子、@Cron、独立上下文、网关、队列     | `scheduler.cron.ts`（api）、`worker.service.ts`（apps/worker）、`gateway.service.ts`    | 写优雅停机测试；BullMQ vs PG 队列 ADR     | worker 网关（已落地·读） |
| **M6** 测试                   | `Test.createTestingModule` + `overrideProvider` | `test/*.spec.ts`、`vitest.config.ts`                                                    | 把一个手写测试改写成 testing module       | 全局质量                 |
| **M7** 超出本项目的版图       | 微服务/GraphQL/CQRS/Swagger/Passport…           | —（官方 sample）                                                                        | 各跑一个官方 sample                       | 选学                     |

---

## 3. 各里程碑详解

### M0 — 环境与心智模型对齐

**学习目标**：搞清 NestJS 在「不打包、跑 TS 源」这套非主流姿势下怎么启动；建立两种应用入口的概念。

**读这些代码**

- [apps/api/src/main.ts](apps/api/src/main.ts) — `NestFactory.create<NestExpressApplication>()`、全局 Filter、`setGlobalPrefix('api')`、`enableShutdownHooks()`、nestjs-pino 注入。
- [apps/worker/src/main.ts](apps/worker/src/main.ts) — `NestFactory.createApplicationContext()`（**无 HTTP 的独立上下文**）。注意现在是**真·独立进程**（`apps/worker` 是独立包，`pnpm --filter @hatch-radar/worker`），不是同一 app 内的第二入口——两者共享同一 PG 队列协调工作。
- [apps/api/package.json](apps/api/package.json) — 看 `dev`/`start` 脚本：`node --import @swc-node/register/esm-register src/main.ts`。**注意本仓不走 `nest build` / nest CLI**，而是 swc 直接跑 TS 源。
- [apps/api/tsconfig.json](apps/api/tsconfig.json) — 确认 `experimentalDecorators` + `emitDecoratorMetadata`（DI 的命根子）。

**动手**

1. `pnpm --filter @hatch-radar/api dev` 跑起来，访问 `GET /api/health`。
2. 单独跑 `pnpm --filter @hatch-radar/worker dev`，对比两个 bootstrap 的差异（api 建 HTTP server，worker 只建 IoC 容器）。两者是独立 pnpm 包，共享同一 PG 数据库队列。
3. 在 `main.ts` 的 bootstrap 里打日志，观察 `enableShutdownHooks` 后 Ctrl-C 的优雅停机顺序（为 M5 铺垫）。

**Midway 对照 & 坑**

- Midway 默认 Koa，本仓是 **Express adapter**（`NestExpressApplication`）——`req/res` 是 Express 的。
- `import 'reflect-metadata'` 必须在最顶（`main.ts` / 测试 `setup.ts` 都做了）。
- 资料：docs.nestjs.com → _First steps_、_Standalone applications_。

---

### M1 — DI 与模块系统 ⭐（Midway 老手的重灾区）

**学习目标**：吃透「provider 不是全局池，而是有模块边界的」这件事——这是你从 Midway 过来唯一真正陌生的核心机制。

**读这些代码**

- [apps/api/src/app.module.ts](apps/api/src/app.module.ts) — 根模块，看 `imports` 里哪些是 `@Global`（Config/Database/Core）、哪些是普通特性模块。
- [apps/api/src/config/app-config.module.ts](apps/api/src/config/app-config.module.ts) — `@Global()` + `useFactory` 提供 `APP_ENV`，并 `exports`。
- [apps/api/src/database/database.module.ts](apps/api/src/database/database.module.ts) — `useFactory` + `inject` 数组接 Prisma（**自定义 provider 的范本**）。
- [apps/api/src/common/tokens.ts](apps/api/src/common/tokens.ts) — `PRISMA`/`APP_ENV`/`CORE` 用 **Symbol token**。
- [apps/api/src/core/core.module.ts](apps/api/src/core/core.module.ts) — ⭐ **本仓最值得精读的 DI 范本**，原 `repositories.module.ts` 的升级版。`createCore(db, env)` 在 NestJS 外一次性装配全部领域实例（仓储 + 服务），再用 `fromCore(ClassName, 'key')` 把每个实例以「其类」为 token 重新注册为 Nest provider（`useFactory: (core) => core[key], inject: [CORE]`）。效果：控制器维持按类型构造注入，零改注入点，同时领域层完全框架无关。这是 `useFactory` 高级用法的教科书示例。

**动手**

1. **画 DI 依赖图**：从 `AppModule` 出发，画出 `imports` 树 + 每个 provider 被谁注入。重点标注「哪些 provider 因为在 `@Global` 模块所以到处能用」。
2. **复现核心报错**：把某个被注入的 service 改成 `import type { XxxService }`，启动看 `Nest can't resolve dependencies of ...`——这就是你们 memory 记的坑，亲手踩一次记得牢（§5.1）。
3. **体会模块边界**：临时把 `DatabaseModule` 的 `@Global()` 去掉，启动会炸；然后改成「在需要 `PRISMA` 的模块里显式 `imports: [DatabaseModule]`」让它复活——这就是 Midway 没有的「可见性」机制。
4. 用四种自定义 provider 各写一个玩具 provider：`useValue`（常量）、`useClass`（换实现）、`useFactory`（带 `inject`）、`useExisting`（别名）。
5. **精读 `CoreModule` 的 `fromCore` 桥接**：理解 `CORE` Symbol token 怎么把框架无关的领域图引入 Nest DI；试着在 worker 侧的 [apps/worker/src/assembly.ts](apps/worker/src/assembly.ts) 找到同样用 `createCore` 的地方，对比两侧桥接方式的异同。

**Midway 对照 & 坑**

- Midway `@Provide` 自动扫描 = 全局可注入；Nest 默认**只在本模块可见**，要 `exports` + `imports` 才能跨模块。`@Global()` 是「我懒得到处 import」的逃生舱，但代价是隐式耦合、难测——本仓只给 Config/DB/Gateway 这种「天生全局单例」用，别滥用（§5.3）。
- class 作 token 是默认；当你要注入「接口/工厂结果/第三方实例」时，用 Symbol/string token + `@Inject(TOKEN)`。
- 循环依赖：要么 `forwardRef()`，要么像本仓一样**把 token 抽到 `tokens.ts`** 打破 import 环。
- 资料：docs.nestjs.com → _Providers_、_Modules_、_Fundamentals/Custom providers_、_Fundamentals/Injection scopes_。

---

### M2 — 请求生命周期与横切关注点 ⭐（账户 RBAC + 审计 Interceptor 全靠这套）

**学习目标**：掌握 Nest 的请求处理管线和五种横切组件，尤其是 **Reflector + `SetMetadata` 元数据驱动**——这是本仓 RBAC 与 §4 审计 Interceptor 的核心机制。

**执行顺序（背下来）**：

```
请求 → 中间件 Middleware → 守卫 Guard → 拦截器 Interceptor(前)
     → 管道 Pipe → 处理器 Handler
     → 拦截器 Interceptor(后) → 异常过滤器 Exception Filter → 响应
```

**读这些代码**

- [apps/api/src/account/session-auth.guard.ts](apps/api/src/account/session-auth.guard.ts) — 最简 `CanActivate`：校验 httpOnly cookie 会话（原 `bearer-auth.guard.ts` / API_TOKEN 已随后端归一退役）。
- [apps/api/src/auth/device-or-session.guard.ts](apps/api/src/auth/device-or-session.guard.ts) — **进阶范本**：**双通道**（mobile 设备 Ed25519 **或** web 用户会话）+ `ExecutionContext` + `Reflector.get(...)` 读 `@RequireDevicePermission` 元数据 + 把 `deviceUser`/`user` 挂到 `req`。原 `machine-or-device.guard.ts` 已演进为此。
- [apps/api/src/auth/device-permission.decorator.ts](apps/api/src/auth/device-permission.decorator.ts) — `SetMetadata` 包出 `@RequireDevicePermission`，`createParamDecorator` 包出 `@DeviceUser()`。**本仓 RBAC 正是大量复用这个模式（已落地）。**
- [apps/api/src/common/zod-validation.pipe.ts](apps/api/src/common/zod-validation.pipe.ts) — `PipeTransform`，用 Zod 校验 `@Body`。
- [apps/api/src/common/http-exception.filter.ts](apps/api/src/common/http-exception.filter.ts) — 全局 `@Catch()`，统一 `{ error }` 契约、不泄露堆栈。
- 看它们在 [apps/api/src/http/sync.controller.ts](apps/api/src/http/sync.controller.ts) / [apps/api/src/http/settings.controller.ts](apps/api/src/http/settings.controller.ts) 怎么用 `@UseGuards` + `@Body(new ZodValidationPipe(schema))`。

**动手**

1. **补上本仓缺的 Interceptor**：写一个 `LoggingInterceptor`，记录每个请求耗时（`intercept(ctx, next)` 里 `next.handle().pipe(tap(...))`）。这是你练 **RxJS Observable 包裹** 的最佳入口（对照 Midway `@Aspect` 的 around），也是 §4 进阶 capstone（审计 Interceptor）的预热。
2. **对照已落地代码脱稿重写一个 Guard**：合上代码，凭 account-rbac-design §4.2 能力目录，自己重写 `device-or-session.guard.ts` 的双通道权限判定，再和仓库实现（+ web [lib/auth/guards.ts](apps/web/src/lib/auth/guards.ts) 的 `requirePermission`）对拍。这是 §4 入门 capstone。
3. 把全局组件三种注册方式都试一遍：`app.useGlobalX()`（main.ts，无法注入依赖）、`@UseGuards()`（路由级）、`APP_GUARD` provider（能注入依赖，§5.7）。

**Midway 对照 & 坑**

- Guard/Pipe/Filter 与 Midway 同名同位，无缝。
- **AOP 是最大不同**：Midway `@Aspect` 的 around 函数，在 Nest 里是 Interceptor 返回 `Observable`——忘了 `return next.handle()` 会**吞掉整个响应**（§5.6）。
- 全局 Pipe/Guard 若需注入依赖，**必须**用 `APP_PIPE`/`APP_GUARD` provider 形式，不能用 `app.useGlobalPipes(new Xxx())`（后者 Nest 无法注入 DI，§5.7）。
- 资料：docs.nestjs.com → _Guards_、_Interceptors_、_Pipes_、_Exception filters_、_Custom route decorators_、_Fundamentals/Execution context_。

---

### M3 — 配置与动态模块（运行期配置中心正是这一套·已落地）

**学习目标**：理解 `@nestjs/config`，以及「带参数的可复用模块」= 动态模块 `forRoot(Async)`，并看懂本仓「保存即热重载、不重启进程」的配置中心是怎么实现的。

**读这些代码**

- [apps/api/src/config/app-config.module.ts](apps/api/src/config/app-config.module.ts) — `ConfigModule.forRoot({ isGlobal, cache, validate })`，但真正的强类型配置走 `APP_ENV` 的 `useFactory`（Zod 解析）。
- [apps/api/src/config/env.ts](apps/api/src/config/env.ts) — Zod schema + `stripEmptyEnv`（空串当未设，[[env-example-required-uncommented]]），产出结构化 `AppEnv`。
- 配套读设计文档 `docs/runtime-config-design.md` §3.5/§4.6 的「热重载」（`reloadAnalysisConfig()` / bump `crawler_config_version`）——这是「运行期可调配置入库、不重启生效」的 NestJS 落法（已实现）。

**动手**

1. 挑一个现在 boot 期固定注入的东西，改造成 `forRootAsync`（用 `useFactory` + `inject: [APP_ENV]` 异步装配），体会动态模块与静态模块的差别。
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

- [apps/api/src/database/database.module.ts](apps/api/src/database/database.module.ts) — `DB_HANDLE`→`PRISMA` 的 `useFactory` 链 + 生命周期管理连接（`OnModuleInit/OnApplicationShutdown` 思路）。
- [packages/db/src/client.ts](packages/db/src/client.ts) + [packages/db/prisma.config.ts](packages/db/prisma.config.ts) — Prisma 7 **driver adapter**（`@prisma/adapter-pg`）、连接串不在 schema 里（[[server-nest-pg-refactor]] 记的坑）。
- [packages/db/src/repositories/providers.repository.ts](packages/db/src/repositories/providers.repository.ts) — **已落地的多 Key 仓储**（原 `apps/server/src/db/`，已迁 `packages/db`）：框架无关类，经 `CoreModule` 的 `fromCore` 桥接注入 Nest。
- [packages/analysis/src/analysis-config.service.ts](packages/analysis/src/analysis-config.service.ts) — `selectKey` + 单任务内故障转移 + 冷却自愈（runtime-config-design §3.3 的实现）。
- 一个用事务的仓储，如 [packages/db/src/repositories/posts.repository.ts](packages/db/src/repositories/posts.repository.ts)（`db.$transaction`）。

**动手**

1. **读懂故障转移**：跟一遍「429→冷却该 Key→换下一把→全挂则任务失败」的链路（runtime-config-design §3.3）。这是一段高质量的真实 NestJS 业务代码，比任何 demo 都值得精读。
2. 仿 `providers.repository.ts` 写一个新仓储（哪怕玩具表），走通「schema → migrate → 生成类型 → `@Inject(PRISMA)` 注入 → 在某 controller 用」全链路。
3. 学官方 `PrismaService extends PrismaClient implements OnModuleInit` 的经典接法，对比本仓的 `useFactory + Symbol token` 接法，理解两者取舍。

**Midway 对照 & 坑**

- Midway 接 Prisma/TypeORM 也是「包成可注入组件」，思路一致；差别只在 Nest 的 provider 注册方式。
- Prisma 7 坑（已在 [[server-nest-pg-refactor]] 记）：无 datasource url 走 `prisma.config.ts`、`bigint↔number` mapper、迁移走 CLI、`db push` 有 AI 同意闸。
- 资料：docs.nestjs.com → _Recipes/Prisma_；Prisma 官方 7.x 文档。

---

### M5 — 异步与长生命周期（worker / 调度 / 网关 / 队列）

**学习目标**：掌握全套生命周期钩子、定时任务、独立应用上下文、WebSocket 网关，并能对「PG 队列 vs BullMQ」这类架构选型做判断。

**读这些代码**

- [apps/api/src/scheduler/scheduler.cron.ts](apps/api/src/scheduler/scheduler.cron.ts) — Nest 侧**薄封装**：只挂 `@Cron` 注解 + 委托 `SchedulerService`（来自 `packages/kernel`）；`ScheduleModule.forRoot()` 在 [scheduler.module.ts](apps/api/src/scheduler/scheduler.module.ts)。业务逻辑本身在 `packages/kernel/src/` 的框架无关层。
- [apps/worker/src/worker.service.ts](apps/worker/src/worker.service.ts) — `OnApplicationBootstrap`（回收僵死任务、起心跳）+ `OnApplicationShutdown`（停定时器、等在途任务）。**这是生命周期钩子的教科书用法。**
- [apps/worker/src/worker.module.ts](apps/worker/src/worker.module.ts) + [apps/worker/src/main.ts](apps/worker/src/main.ts) — `createApplicationContext` 跑无 HTTP 的独立 worker 进程（**真·独立 pnpm 包** `@hatch-radar/worker`）。
- [apps/api/src/domain/gateway/gateway.service.ts](apps/api/src/domain/gateway/gateway.service.ts) — 手搓 `ws` 网关推任务（**注意：不是 `@nestjs/websockets`**，对比官方 Gateway 理解取舍）；设计见 `docs/worker-push-gateway-design.md`。
- [packages/db/src/repositories/jobs.repository.ts](packages/db/src/repositories/jobs.repository.ts) — **PG 表当任务队列**（状态机 + 部分唯一索引保幂等），而非 BullMQ。

**动手**

1. 给 `worker.service.ts` 的优雅停机写一个测试：发任务 → 触发 shutdown → 断言在途任务被等完、不丢。
2. **写一份 ADR**：「PG 队列 vs `@nestjs/bullmq`+Redis」。本仓选了 PG（无 Redis 依赖、持久、单实例 DB 锁协调）——把权衡写清楚（[[analyzer-redesign-plan]] 当初纠结过）。学 `@nestjs/bullmq` 的 `@Processor/@Process` 心智，知道什么场景该换。
3. 跑通官方 `@nestjs/schedule` 的 `@Interval`/`@Timeout`/动态 `SchedulerRegistry`，补足只用过 `@Cron` 的盲区。

**Midway 对照 & 坑**

- Midway 的 `onReady/onStop` ≈ Nest 的 `OnApplicationBootstrap/OnApplicationShutdown`；`@midwayjs/cron`、`@midwayjs/bull` 一一对应。
- `enableShutdownHooks()` 不开，`OnApplicationShutdown` 不会触发（M0 已见）。
- 单实例假设：本仓 `@Cron` 用进程内 `Set` 防并发——多实例部署会重复跑（设计文档已声明单实例），这是要记住的约束。
- 资料：docs.nestjs.com → _Techniques/Task scheduling_、_Techniques/Queues_、_Fundamentals/Lifecycle events_、_Standalone applications_、_WebSockets/Gateways_。

---

### M6 — 测试（补上 `Test.createTestingModule`）

**学习目标**：学会 Nest 官方测试模块和 `overrideProvider`——本仓现在是「手动 `new` + 真库」，能跑但没用上 Nest 的 DI 测试能力，这正是你该补的差。

**读这些代码**

- [apps/api/test/settings-controller.spec.ts](apps/api/test/settings-controller.spec.ts) — 看现在怎么手动 `new SettingsController(...)` + stub 依赖。
- [apps/api/test/provider-keys.spec.ts](apps/api/test/provider-keys.spec.ts) — 多 Key 故障转移的真实测试。
- [apps/api/vitest.config.ts](apps/api/vitest.config.ts) + [apps/api/test/setup.ts](apps/api/test/setup.ts) — `@` 别名、`import 'reflect-metadata'`、`fileParallelism: false`（共享单测试库）。

**动手**

1. 挑一个手写 `new` 的测试，**改写成** `Test.createTestingModule({...}).overrideProvider(PRISMA).useValue(fakeDb).compile()` 再 `moduleRef.get(Controller)`，对比两种风格的取舍（速度 vs 真实装配）。
2. 给 M2 写的 `LoggingInterceptor` / 重写的权限 Guard 写单测（`overrideProvider` mock 掉依赖）。
3. 学 e2e：`Test` + `supertest` 打真实 HTTP（`createNestApplication`），知道何时该用 e2e 而非单元。

**Midway 对照 & 坑**

- `@midwayjs/mock` 的 `createApp/close` ≈ Nest 的 `Test.createTestingModule().compile()` + `app.close()`，但 Nest 的 `overrideProvider/overrideGuard` 替换能力更细。
- vitest 跑 Nest 必须 `import 'reflect-metadata'`（本仓 `setup.ts` 已做），否则 DI 元数据为空。
- 资料：docs.nestjs.com → _Fundamentals/Testing_。

---

### M7 — 超出本项目的 NestJS 版图（知道有，按需深入）

本仓没用、但生态主流、面试/接活会遇到的。各跑一个官方 `sample/` 即可，不必现在深挖。

| 主题                   | 包                                                       | 何时需要 / 与本仓的关系                                                                                       |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Nest CLI + schematics  | `@nestjs/cli`                                            | `nest g module/controller/service` 脚手架、monorepo。本仓没用（swc 跑源）                                     |
| class-validator 校验   | `class-validator` + `ValidationPipe`                     | **生态默认**校验路线。本仓用 Zod——学它好理解别人的代码                                                        |
| OpenAPI / Swagger      | `@nestjs/swagger`                                        | 自动生成 API 文档。本仓未引入——可作 §4 可选增量                                                               |
| 认证 / 授权            | `@nestjs/passport` + JWT                                 | 主流 auth。**对照本仓手搓的会话/设备验签**——理解 account-rbac 为何不用 Passport（内网、设备密钥、零额外依赖） |
| 微服务                 | `@nestjs/microservices`                                  | TCP/Redis/NATS/Kafka/gRPC/RabbitMQ 传输。本仓单体 + WS 内部推送                                               |
| GraphQL                | `@nestjs/graphql`                                        | 本仓纯 REST                                                                                                   |
| CQRS                   | `@nestjs/cqrs`                                           | 命令/查询/事件分离。本仓规模用不上                                                                            |
| 限流 / 缓存 / 健康检查 | `@nestjs/throttler` / cache-manager / `@nestjs/terminus` | 本仓登录限流是手写落表、健康检查是手写 `/api/health`——terminus 可作 §4 可选增量                               |
| Fastify adapter        | `@nestjs/platform-fastify`                               | 换更快的 HTTP 层。本仓用 Express                                                                              |

资料：docs.nestjs.com 对应章节；GitHub `nestjs/nest` 仓库的 `sample/` 目录有几十个可跑示例。

---

## 4. 实战主线（capstone）

> **现状校准（重要）**：本仓 server 已相当成熟——**运行期配置中心**（多 Key 故障转移 + 数据源/连接器入库，commit `a093903`/`937f558`）与**账户 RBAC**（web 登录会话 + 设备验签 + 用户态 + 登录限流落表，commit `126391c`/`f847105`/`92a5e97`/`18b85f0`）**两大块都已落地、带测试**。schema 里 `users`/`user_permissions`/`sessions`/`device_credentials`/`audit_logs`/`login_attempts` 齐全；`packages/auth`、`packages/shared/permissions.ts`、web `login`/`admin/accounts`/`admin/audit` 都在。
>
> 这对学习是**好事**：你有一份覆盖几乎所有 NestJS 模式的、真实且经测试的代码可精读。所以主线从「建大特性」改为 **「精读落地实现 + 做小而真的增量」**——下面据此重排。

### 入门 capstone：精读并脱稿重写 RBAC 鉴权链路（已落地）

- **性质**：纯读 + 在测试里重写，零风险，覆盖 M1+M2+M6。
- **做什么**：
  1. 跟读 `docs/account-rbac-design.md` → 对照实现逐段印证：服务端 [device-or-session.guard.ts](apps/api/src/auth/device-or-session.guard.ts) + [device-auth.service.ts](apps/api/src/auth/device-auth.service.ts)（via `packages/auth`）+ [device-permission.decorator.ts](apps/api/src/auth/device-permission.decorator.ts)；web 侧 [apps/web/src/lib/auth/guards.ts](apps/web/src/lib/auth/guards.ts)（`requireSession`/`requirePermission`）；共享 [packages/shared/src/permissions.ts](packages/shared/src/permissions.ts)、`packages/auth/src`（scrypt/session/Ed25519）。
  2. **脱稿重写**：合上实现，凭 §4.3 授权语义 + §4.4 越权护栏自己写一遍 `DeviceOrSessionGuard`（双通道），再用 M6 的 `Test.createTestingModule` + `overrideProvider` 给它写测试，最后和仓库实现对拍。
- **练到的**：Guard + `ExecutionContext` + `Reflector` + `createParamDecorator` + 测试 module，把 M2 全套吃透。

### 进阶 capstone：审计 Interceptor（**全仓唯一没用过的横切模式**）⭐

- **性质**：**真·net-new**。本仓**至今没有任何 Interceptor**（已核实），而审计现在是**手动散写**（server 在 [device-auth.service.ts](apps/api/src/auth/device-auth.service.ts)（via `packages/auth`）、[sync.controller.ts](apps/api/src/http/sync.controller.ts) 里逐处调；web 在 [lib/auth/audit.ts](apps/web/src/lib/auth/audit.ts)）。把它收敛成一个声明式 Interceptor，正好兑现 `runtime-config-design.md` §7 那条未来项「Key/凭据变更写 `audit_logs`，RBAC 落地后接入」（如今 RBAC 已落地，可做）。
- **做什么**：
  1. 写 `@Audit('analyze.run')` 元数据装饰器（`SetMetadata`，仿 `device-permission.decorator.ts`）。
  2. 写 `AuditInterceptor implements NestInterceptor`：`intercept(ctx, next)` 里用 `Reflector` 读 action，`next.handle().pipe(tap(() => writeAudit(...)))` 在处理成功后落 `audit_logs`，附操作者（从 `req.deviceUser`/会话解析）。
  3. 以 `APP_INTERCEPTOR` provider 全局注册（**注意**：必须走 provider 形式才能注入 audit 仓储，§5.7）。
  4. 把现有手动审计点改成 `@Audit(...)` 声明，删掉散落的调用。
- **练到的**：Interceptor（RxJS `tap`）+ `APP_INTERCEPTOR`（可注入依赖）+ `Reflector` 元数据 + Prisma 仓储——一次打通 M2 最难的一块和 M4。
- **验收**：敏感/计费端点自动落审计、操作者归属正确、有测试；手动审计调用清零。

### 还想多练？任选一个真·未建增量

- **多连接器故障转移**（runtime-config-design §10 / D5，schema 已支持未实现）——和已落地的「多 Key 故障转移」同构，照着 [providers.repository.ts](packages/db/src/repositories/providers.repository.ts) 抄到 [source-connectors.repository.ts](packages/db/src/repositories/source-connectors.repository.ts)。练 M4。
- **按源定制轮询频率** `sources.config.cadence`（runtime-config-design §10）——调度按 cadence 分桶。练 M5（`SchedulerRegistry` 动态任务）。
- **补 Swagger 或健康检查**（M7）——引 `@nestjs/swagger` 给现有 controller 出 OpenAPI，或 `@nestjs/terminus` 把手写 `/api/health` 升级成标准探针。练 net-new NestJS 面。

> 建议路径：**入门 capstone（精读+重写，3–5 天）→ 进阶 capstone 审计 Interceptor（主线，1–2 周）→ 任选增量**。M3–M6 的知识点在做这两条时自然补齐。

---

## 5. Midway 老手坑清单（cheat sheet）

按踩坑概率排序，前 3 个几乎必踩。

1. **`import type` 杀 DI** ⭐——构造注入靠 `emitDecoratorMetadata` 写入的 `design:paramtypes`；`import type { Foo }` 只保留类型、运行时把 import 擦掉，metadata 变 `Object`/`undefined`，报 `Nest can't resolve dependencies`。**注入用的类型一律普通 `import`**（[[server-nest-pg-refactor]] 已记）。
2. **`Nest can't resolve dependencies of X (?)`** ⭐——最常见报错。`(?)` 那个位置的依赖没找到。99% 是：provider 没在某 module 的 `providers` 里，或没 `exports`，或消费方没 `imports` 提供方模块。学会读这个错就解决一半问题。
3. **`@Global()` 滥用**——Midway 直觉「装了就能用」会诱使你把什么都设 `@Global`。代价是隐式耦合、测试难隔离。只给「天生全局单例」（Config/DB/Logger）用；业务模块老老实实 `exports`+`imports`。
4. **循环依赖**——A 注入 B、B 注入 A → 用 `forwardRef(() => X)`，或像本仓把 token 抽到 `tokens.ts` 打破 import 环。
5. **可选注入**——依赖在某些进程不存在（如本仓 `GatewayService` 在独立 worker 里没有）→ 用 `@Optional()`，否则启动炸。
6. **Interceptor 忘了 `return next.handle()`** ⭐——会**吞掉整个响应**（请求挂起）。Interceptor 是 RxJS 流，不是 Midway `@Aspect` 的 around；后置逻辑用 `.pipe(tap/map)`。
7. **全局组件无法注入依赖**——`app.useGlobalGuards(new Xxx())` 里的 `Xxx` 拿不到 DI。需要依赖就改用 `APP_GUARD`/`APP_PIPE`/`APP_FILTER`/`APP_INTERCEPTOR` provider 形式注册。
8. **`Scope.REQUEST` 传染**——请求作用域的 provider 会让**所有依赖它的上游**也变请求作用域，每请求重建、性能下降。非必要不用；本仓全是默认单例。
9. **Express vs Koa**——本仓是 Express。`req/res` 是 Express 的；一旦用 `@Res()` 手动操作响应，Nest 的**自动序列化/拦截器后置就失效**了（除非 `passthrough: true`）。
10. **测试缺 `reflect-metadata`**——vitest/jest 入口不 `import 'reflect-metadata'`，DI 元数据全空、装配失败（本仓 `test/setup.ts` 已处理）。

---

## 6. 资料清单

**官方（按里程碑顺序读）**

- docs.nestjs.com — _First steps_（M0）→ _Providers_ / _Modules_ / _Custom providers_ / _Injection scopes_（M1）→ _Guards_ / _Interceptors_ / _Pipes_ / _Exception filters_ / _Custom decorators_ / _Execution context_（M2）→ _Configuration_ / _Dynamic modules_（M3）→ _Recipes/Prisma_（M4）→ _Task scheduling_ / _Queues_ / _Lifecycle events_ / _Standalone applications_ / _Gateways_（M5）→ _Testing_（M6）。
- GitHub `nestjs/nest` 的 **`sample/`** 目录——几十个可跑示例，M7 各主题都有。
- 官方 **NestJS Fundamentals Course**（Trilon，付费）+ **Nest Devtools**（可视化模块/依赖图，正好帮你做 M1 的依赖图）。

**本仓配套**

- `docs/server-nest-postgres-refactor-plan.md` — 当初为何/如何迁到 NestJS（理解决策背景）。
- `docs/runtime-config-design.md` — 运行期配置中心（已落地）的设计依据，§4 增量对照用。
- `docs/account-rbac-design.md` — 账户 RBAC（已落地）的设计依据，入门 capstone 精读对照。
- `docs/worker-push-gateway-design.md` — M5 网关部分。

**对照 Midway**

- Midway 文档的「依赖注入 / 组件 / 生命周期 / Web 中间件守卫」章节，与本计划 §1 表逐项对照，能最快建立映射。

---

## 7. 进度勾选

- [ ] M0 环境与心智
- [ ] M1 DI 与模块系统 ⭐
- [ ] M2 请求生命周期 / 横切 ⭐
- [ ] M3 配置与动态模块
- [ ] M4 数据层（Prisma）
- [ ] M5 异步与长生命周期
- [ ] M6 测试
- [ ] M7 版图速览（选学）
- [ ] 入门 capstone：精读并脱稿重写 RBAC 鉴权链路
- [ ] 进阶 capstone：审计 Interceptor（全仓首个 Interceptor）⭐
- [ ] （可选）真·未建增量：多连接器故障转移 / 按源 cadence / Swagger·terminus
