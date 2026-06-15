# @hatch-radar/server-midway —— MidwayJS API（控制面）

工作台后端的 **MidwayJS 4.x 版**，与 NestJS 版 [`@hatch-radar/server`](../server) 功能等价、行为一致，
用于并排对比两框架（**验收只需换端口**：A=NestJS 47878，B=MidwayJS 47879，同库同契约）。

本目录是 **API / 控制面**。整套 MidwayJS 版按职责拆成三块：

| 包 | 角色 | 内容 |
|---|---|---|
| [`packages/core`](../../packages/core) | **框架无关领域核心** | 仓储 + 分析 + 爬虫 + 运行期配置 + 调度/网关/worker 执行 + 装配工厂 `createCore()`。不依赖任何 Web 框架,api 与 worker（及未来 Nest 版）共用 |
| `apps/server-midway`（本目录） | **API（控制面，单实例）** | HTTP + 鉴权 + 控制器 + 定时调度（cron）+ push 网关。`onReady` 里 `createCore` 装配领域实例、以 `registerObject` 按字符串令牌登记,控制器经 `@Inject(TOK.x)` 注入 |
| [`apps/server-midway-worker`](../server-midway-worker) | **worker（数据面，可横向扩 N 实例）** | 纯队列消费者:经 WS 连 API 网关认领 job、跑分析、写回。无 Web 框架,直接用 `core` |

> 为什么拆：API 负载低（单实例足够,cron 也要求单实例）；要扩的是 worker（AI 吞吐）。两者只通过
> ① PG 队列 ② 一条 `/ws/worker` 连接,互相解耦。派发用 **push**（入队即推给最闲 worker,低延迟）。

---

## 一、怎么跑

前置：PostgreSQL 已起（`docker compose up -d db`，本地 `47432/hatch_radar`），且已迁移。

```bash
# A 端口：NestJS 版（默认 47878）—— 对比基准
pnpm --filter @hatch-radar/server start

# B：MidwayJS API（控制面，默认 47879）
pnpm --filter @hatch-radar/server-midway start

# B 的 worker（数据面，另起一个进程；可起多个做横向扩）
pnpm --filter @hatch-radar/server-midway-worker start
```

启动后 API 日志出现 `[gateway] worker 注册: ...`、worker 日志出现 `[worker-agent] 注册成功` 即握手成功。
对同一接口发同样请求即可与 NestJS 版对照：

```bash
curl -s localhost:47878/api/health   # NestJS
curl -s localhost:47879/api/health   # MidwayJS API  → 同样的 { ok, now, stats }
```

`.env` 关键约定：API 与 worker 的 `DATABASE_URL`、`SETTINGS_SECRET` **必须和 NestJS 版完全一致**
（共享库 + 同一把加密主密钥才能解密已存的模型 Key）；API 用 `HTTP_PORT=47879`，worker 用 `GATEWAY_URL=ws://localhost:47879/ws/worker`。

> ⚠️ API 内置定时调度（与 NestJS 版一样会每轮抓取）。两版同时跑会各自抓一轮（写同一库，幂等 upsert，无脏数据，仅日志翻倍）。只比 HTTP 层时只启其一即可。

其它脚本：各包均有 `dev`（--watch 热重载）与 `typecheck`（`tsc --noEmit`）。

---

## 二、运行方式：与 NestJS 版同构

为了能直接复用以「**裸 TS 源**」形式发布的 `@hatch-radar/*`（无 dist、`exports` 指向 `src/index.ts`，Prisma 7 客户端按 ESM 生成），
本项目和 NestJS 版一样**以 ESM + `@swc-node/register` 直跑 TS 源、不打包**：

```
node --import @swc-node/register/esm-register src/main.ts
```

因此 **不走** Midway 默认的 `mwtsc`/`tsc` 编译到 `dist` 的链路（那样无法在运行期消费裸 TS 工作区包）。
`tsconfig.json` 沿用 `@hatch-radar/config/tsconfig.nest.json`（`moduleResolution: Bundler` + `@/* → src/*`），与 NestJS 版逐字一致。

---

## 三、NestJS → MidwayJS 对照表

| 关注点 | NestJS 版 | MidwayJS 平替版 |
|---|---|---|
| 模块边界 | `@Module({imports,providers,controllers})` | **无模块**。`@Configuration` 只声明组件（`imports:[koa,cron]`）+ `ESModuleFileDetector` 扫描 `src` 下的 `@Provide/@Controller/@Job` |
| 启动引导 | `NestFactory.create(AppModule)` + `app.listen()` | `Bootstrap.configure({moduleLoadType:'esm'}).run()`（`src/main.ts`） |
| 全局前缀 / body 上限 | `setGlobalPrefix('api')` / `useBodyParser('json',{limit:'5mb'})` | `config.default` 的 `koa.globalPrefix:'/api'` / `bodyParser.jsonLimit:'5mb'` |
| DI 提供者 | `@Injectable()` | `@Provide()` + `@Singleton()` |
| 构造注入 | `constructor(private readonly x: Foo)` | **属性注入** `@Inject() x!: Foo`（避开实例化时序坑） |
| 令牌注入 | `@Inject(PRISMA)`（Symbol） | `@Inject(PRISMA)`（字符串标识，`common/tokens.ts`），实例在 `onReady` 用 `container.registerObject` 原样注册 |
| 控制器 / 路由 | `@Controller('x')` `@Get()/@Post()` `@Delete` | `@Controller('/x')` `@Get('/')` `@Del`（注意前导 `/`，删除是 `@Del`） |
| 入参校验 | `@Body(new ZodValidationPipe(schema))` | 自定义参数装饰器 `@ValidBody(schema)`（`common/params.ts`，`createCustomParamDecorator`） |
| 当前用户 / 设备 | `@AuthUser()` / `@DeviceUser()`（`createParamDecorator`） | 同名 `@AuthUser()` / `@DeviceUser()`（`createCustomParamDecorator`，从 `ctx.user`/`ctx.deviceUser` 取） |
| 整数路径参 | `@Param('id', ParseIntPipe)` | `@IntParam('id')`（非整数 → 400） |
| 守卫 | `@UseGuards(G)` + `implements CanActivate` + `Reflector` | `@UseGuard(G)` + `implements IGuard` + `getPropertyMetadata ?? getClassMetadata`（方法级覆盖类级） |
| 权限元数据 | `@RequirePermission(k)`（`SetMetadata`） | `@RequirePermission(k)`（`savePropertyMetadata`/`saveClassMetadata`，可类/方法两用） |
| 异常过滤 | `@Catch()` `implements ExceptionFilter` | `@Catch()`（`catch(err,ctx)` 设 `ctx.status/ctx.body`），`app.useFilter` 注册 |
| HTTP 异常 | `HttpException`/`BadRequestException`… | `MidwayHttpError(msg,status)` / `httpError.BadRequestError`… |
| 定时任务 | `@Cron('0,30 * * * *')`（`@nestjs/schedule`） | `@Job({cronTime:'0,30 * * * *',start:true})`（`@midwayjs/cron`，同用 `cron` 库，5 段表达式一致） |
| 生命周期 | `OnModuleInit`/`OnApplicationBootstrap`/`OnApplicationShutdown` | `@Configuration` 的 `onReady`/`onServerReady`/`onStop`，内用 `container.getAsync` 惰性解析后台服务 |
| WS 网关 | `HttpAdapterHost.getHttpServer()` + 原生 `ws` | `onServerReady` 取 `koa.Framework.getServer()` + 原生 `ws`（同 `/ws/worker`） |
| 同源托管 SPA | `@nestjs/serve-static` + `exclude(/api,/ws)` | 自写 `SpaMiddleware`（`web/spa.middleware.ts`，`/api`、`/ws` 放行，其余回退 `index.html`） |
| 日志 | `nestjs-pino` | 复用同一份 pino（`src/logger`），Midway 框架日志压到 warn |

> POST 默认状态码：NestJS POST 默认 **201**，koa/Midway 默认 **200**。已逐一对照——
> NestJS 里靠默认 201 的端点（enroll、settings/sources/connectors 的 POST 及各 `/test`），在 Midway 显式补了 `@HttpCode(201)`。

---

## 四、踩过的 Midway 坑（关键学习点）

1. **swc-node 直跑须置 `MIDWAY_TS_MODE=true`**：否则 Midway 检测不到 TS 环境（`require.extensions['.ts']` 在 ESM loader 下不存在），会去找编译后的 `configuration.js` 而报 *Main framework missing*。见 `main.ts`（在 `import Bootstrap` 前设置）。
2. **PRISMA 客户端用 `registerObject` 而非 `providerWrapper` 工厂**：`providerWrapper` 注册的工厂在「属性注入」时会被**原样注入而不被调用**（注入到的是工厂函数本身）；改用 `container.registerObject(PRISMA, client)` 原样存引用，才能保住 Prisma 7 客户端（Proxy）的全部 `$` 方法。
3. **`registerObject` 须早于任何消费者解析**：配置类自身的 `@Inject` 字段在「实例化时」即解析，早于 `onReady`。故所有依赖 PRISMA 的后台服务（seed/gateway/worker/scheduler）一律在 `onReady/onServerReady` 里 `container.getAsync` **惰性解析**，cron `@Job` 则在 `onTick`（启动后才触发）惰性取 `SchedulerService`。
4. **用自定义参数装饰器的控制器方法必须 `async`**：`@ValidBody/@AuthUser/...` 经「异步 aspect 的 before 钩子」改写入参，同步方法拿不到改写值（会回落成 koa `ctx`）。内置 `@Query/@Param` 不受此限。
5. **校验装饰器置 `throwError:true`**：否则参数 handler 抛出的校验错误会被 Midway 吞掉、回落原始参数。
6. **领域核心拆出去后,只能按「字符串令牌」注入**：`packages/core` 是框架中立的纯类（无 `@Provide`,Nest 才能复用）。实测 `registerObject(SomeClass, instance)` + `@Inject() x: SomeClass`（按类型注入）**解析不到**（Midway 回落到属性名）。故 api 用 `createCore()` 一处装配出依赖图,`registerObject('core:x', instance)` 登记,控制器/守卫 `@Inject(TOK.x)` 按令牌注入（同 PRISMA）。`AnalysisConfigService` 的网关依赖做成可选 `Dispatcher`（api 传 gateway、worker 传空）；`admin.service` 的 `httpError.*` 改成框架中立的 `DomainError(msg,status)`（过滤器仍按 `.status` 映射）。

---

## 五、与 NestJS 版的已知差异

- **未命中路由的 404 文案**：NestJS 为 `{"error":"Cannot GET /x"}`，Midway 为 `{"error":"/x Not Found"}`。**状态码（404）与响应形状（`{error}`）一致**，仅框架默认文案不同；业务 404（如「洞察不存在」「帖子不存在或已归档」）逐字一致。
- **未移植单元测试**：`apps/server/test/*` 基于 `@nestjs/testing`，本平替版聚焦「可运行 + HTTP 契约对齐」，未移植测试套件（已通过 `tsc --noEmit` 全量类型检查 + 与 NestJS 版逐端点 side-by-side 验证）。

其余（全部 `/api/*` 路由、鉴权两通道、CSRF、能力闸、错误契约、定时抓取、worker 队列、网关分发、种子）均与 NestJS 版等价，并经并排对照验证。
