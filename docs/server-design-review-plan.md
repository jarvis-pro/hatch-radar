# apps/server 设计评审与改进计划

> 一次对 `apps/server`（NestJS + PostgreSQL，爬取 + AI 分析 + 调度 + 导出 + 同步）的全面设计评审，
> 以及据此排定的改进事项。逐条推进，完成一条勾一条。
>
> 评审范围：`apps/server/**`、`packages/db/**`、`packages/config/**`、schema/迁移、测试、CI、文档。
> 评审基线提交：见本文件入库时的 git 历史（Prisma 迁移已合并 main）。

## 总体评价

工程水准整体高于一般业务后端，**不是推倒重来的对象**。已有的优秀设计应保留：

- 队列用 `FOR UPDATE SKIP LOCKED` + 心跳 + 僵死回收 + 启动回收孤儿，并发认领不重不漏，且有针对性集成测试。
- 洞察契约单一数据源：一份 Zod schema 同时产出模型 JSON Schema 与落库类型，编译期断言绑定 `@hatch-radar/shared`。
- analyzer 纯函数无 DI、无副作用；落库唯一收口在 `AnalysisService`；DI 令牌单独成文件。
- bigint↔number / jsonb 转换单点收敛在 mappers；web 只读纵深防御（连接级 `default_transaction_read_only`）。

问题集中在 **多进程一致性、模型/文档脱节、若干增长与性能尖角**。

---

## 改进事项（按阶段推进）

### 阶段 0 — 拆雷 + 防回归（低风险、高价值）

#### 0.1 schema 时间戳注释「毫秒」→「秒」- **现状**：`packages/db/prisma/schema.prisma` 多处注释写「epoch 毫秒」（`analysis_jobs.enqueued_at`/`started_at`/`finished_at`/`heartbeat_at`、`comments.fetched_at`、`insights.created_at`、`posts.fetched_at` 等），但代码一律 `BigInt(nowSec())`（秒），`created_utc` 也是秒。

- **问题**：当前内部自洽无运行时 bug，但 schema 是数据模型权威文档，注释说谎 → 后人按「毫秒」写 `Date.now()` 比对即 1000× 偏差，refresh 节奏 / 僵死回收 / 归档全错。
- **方案**：把所有本地时间戳列注释统一改为「epoch 秒」。
- **验收**：`grep 毫秒 schema.prisma` 无残留；`pnpm --filter @hatch-radar/db typecheck` 通过。

#### 0.2 CI 接上 typecheck / lint / test- **现状**：`.github/workflows/` 只有 `arch-boundary.yml`（校验 mobile 不依赖 @hatch-radar/db），未跑 typecheck / lint / test，尽管三者脚本都已就绪。

- **方案**：新增 workflow：
  - `typecheck`（全 workspace）+ `lint`；
  - `test`（起 `postgres:17` service，`prisma db push --force-reset` 到 `hatch_radar_test` 后 `pnpm --filter @hatch-radar/server test`）。
- **验收**：PR / push 触发，三步均绿。

#### 0.3 文档脱节修正- **现状**：迁移到 Prisma 后文档大面积未跟上：

- `README.md` 6 处仍写 Drizzle；`pnpm db:migrate` 称 drizzle-kit；引用不存在的 `scripts/migrate-sqlite-to-pg.ts`。
- `crypto.ts`、`.env.example` 仍写「web 直读同一个 SQLite 只见密文」（已是 PG）。
- `env.ts` `HTTP_PORT` JSDoc 写「默认 8787」，实际 `DEFAULT_HTTP_PORT=47878`。
- `.env.example` 提 `pnpm serve`，但无该脚本。
- `docs/server-nest-postgres-refactor-plan.md` 残留 Drizzle（历史计划书，标注「已落地为 Prisma」即可，不强改）。
- **方案**：逐处订正为 Prisma / PG / 正确端口；删除失效命令引用。
- **验收**：`grep -i drizzle README.md` 为 0；`grep 8787 env.ts`、`grep -i sqlite crypto.ts` 无误导性残留。

### 阶段 1 — 正确性（多进程一致性）

#### 1.1 跨进程热重载失效（独立 Worker 永远拿旧密钥）- **现状**：`AnalysisConfigService.processorCache` 进程内缓存「解密后的处理器」，靠 `reloadAnalysisConfig()` 清空，而该方法只在 HTTP 进程的 `SettingsController` 写操作里调用。`WORKER_IN_PROCESS=false` 时 Worker 独立进程有自己的缓存实例，**改密钥/模型/停用通知不到它**，直到重启都用旧密钥。证伪 README「改密钥即热重载无需重启」。

- **方案（config_version 比对）**：
  - `app_settings` 增一行 `analysis_config_version`（或复用计数）；任意 provider/active 写操作 `+1`。
  - `getProcessorForProvider` / 认领任务路径在取缓存前比对版本，落后即 `processorCache.clear()` 再重建。
  - 同进程模式行为不变；独立 Worker 下个任务即感知变更。
- **备选**：PG `LISTEN/NOTIFY`；或不缓存处理器、只 memoize 派生密钥（与 2.4 协同）。
- **验收**：新增测试——改 provider 后，独立实例的 `getProcessorForProvider` 返回用新配置构建的处理器。

### 阶段 2 — 增长与性能

#### 2.1 `analysis_jobs` 保留期清理- **现状**：归档 cron 只清 posts/comments，不动 jobs；终态 job 行只增不减（~1.4 万行/月量级）。

- **方案**：归档任务追加「删除 N 天前的终态（succeeded/failed/canceled）job」，保留近 N 天；N 可配（默认 30）。
- **验收**：归档后终态老 job 被清，queued/running 不受影响。

#### 2.2 `getJobStats` 去全表扫- **现状**：每次 web 看板轮询都对整表 `groupBy(status)`，随表线性变慢。

- **方案**：配合 2.1 控制表规模即可显著缓解；如需进一步，给 status 上部分索引/计数缓存。先做 2.1，评估后再定是否加缓存。
- **验收**：表规模受控；看板轮询查询计划走 `idx_jobs_status`。

#### 2.3 `ExportService.collectBatch` 消除 N+1- **现状**：每条 insight 单独 `findUnique` 帖子 + `findMany` 评论，`for…await` 串行，`1+2N` 次往返。

- **方案**：收集 `post_id` 后两条 `IN` 批量查询（posts、comments），内存按 post 分组；总查询降到 3 条。保持导出字节级产物不变。
- **验收**：导出结果与改前一致（counts、行内容）；查询数与 N 解耦。

#### 2.4 scrypt 派生密钥 memoize- **现状**：`deriveKey()` 每次加解密都跑 `scryptSync`（故意慢 ~50–70ms），`listProviders` 渲染掩码对每条解密一次 → N 次 scrypt。

- **方案**：进程内按 `SETTINGS_SECRET` 值 memoize 派生密钥；secret 变更（理论上不会运行期变）自动重派生。
- **验收**：`encrypt/decrypt` 行为不变；多次调用只派生一次。

### 阶段 3 — 一致性与架构清晰

#### 3.1 主进程单实例约束显式化- **现状**：`SchedulerService` 用进程内 `Set` 做非重入、无分布式锁；主进程多开会重复抓取 / 重复初始化轮次。Worker 层却为多进程设计，拓扑约束不对称且未声明。

- **方案**：先在 README / 部署文档明确「主进程单实例，Worker 可多实例」；视需要再给 cron 套 PG advisory lock。本阶段先做文档化（低风险），advisory lock 列为可选后续。
- **验收**：文档明确约束。

#### 3.2 错误返回风格统一- **现状**：多数端点 throw `HttpException` 交全局过滤器；`settings test` / `analysis run` 手动 `res.status(400)` 返回 `{ok:false}`。

- **方案**：统一为抛异常 + 全局过滤器；连通性测试这类「业务失败非请求错误」如需保留 200 包体，明确约定并注释，不要混用。
- **验收**：风格一致；web 端解析不受影响（必要时同步 web 调用方）。

#### 3.3 两条分析路径收敛- **现状**：队列路径之外，CLI `analyze` 走 `runBatch` 内联分析、绕过队列，与运行中的 Worker 可竞争同批帖子。

- **方案**：CLI `analyze` 改为「入队 + 提示由 Worker 消费」，或保留 `runBatch` 但显式标注「仅 server 停机时用」。倾向前者以单一路径。
- **验收**：CLI 不再与 Worker 竞争；`runBatch` 去留有定论。

#### 3.4 日志风格统一- **现状**：多数服务直接 `import { logger }`（全局 pino 单例），少数用 NestJS 注入式 `new Logger(...)`。

- **方案**：统一到一种（倾向 NestJS 注入式以便测试替换；或明确全局 logger 为约定并去掉零散 `new Logger`）。范围较大，按文件渐进。
- **验收**：风格一致或有明确约定。

### 阶段 4 — 清理

#### 4.1 死代码 / 未兑现 schema- `export_locked_at`：server 端从不写、refresh 也不检查 → 要么实现「锁定暂停 refresh」，要么从 server 私有列移除（注意 mobile/导出 DDL 兼容）。

- `job_status.canceled`：无 setter、无端点 → 要么补 cancel 能力，要么注释标注「预留」。
- **方案**：本轮选择「标注预留 + 移除误导注释」，避免牵动导出/mobile schema 的破坏性改动。
- **验收**：注释与实现一致，不再有「承诺未兑现」。

#### 4.2 `buildContext` 归位- **现状**：在 `crawler/context.ts`，但属 analyzer 关注点，造成 analyzer→crawler 反向依赖。

- **方案**：移到 `analyzer/`，更新 import。
- **验收**：依赖方向理顺；typecheck 通过。

#### 4.3 配置集中化补漏（可选）- `SETTINGS_SECRET`（schema 校验后被丢弃，crypto 直读 process.env）、`WORKER_IN_PROCESS`、`databaseUrl()`、`LOG_DIR` 等绕过 AppEnv。

- **方案**：能纳入 AppEnv 的纳入；确需早于 DI 读取的（logger/worker 开关）保留但注释说明。低优先，按收益决定是否做。

#### 4.4 Worker 关键参数可配（可选）- `DEFAULT_CONCURRENCY`、各 timeout/stale 阈值硬编码 → 提供 env 覆盖（默认值不变）。

#### 4.5 测试补全（可选）- 现仅队列 + 同步。按收益补 crypto、export(N+1 回归)、analyzer 归一化、热重载(1.1) 的测试。

---

## 推进顺序与状态

- [x] 0.1 schema 时间戳注释改「秒」（typecheck/lint 通过）
- [x] 0.2 CI 接 typecheck/lint/test（新增 ci.yml；test/global-setup 改 migrate deploy；补回缺失的 migration_lock.toml——原 `pnpm db:migrate` 因缺它本就跑不通）
- [x] 0.3 文档脱节修正（README 去 Drizzle、删失效脚本引用、SQLite→PG、端口）
- [x] 1.1 跨进程热重载（config_version）——加版本号读/+；取缓存前比对失效；回归测试
- [x] 2.1 analysis_jobs 保留期清理（归档 cron 加 deleteFinishedJobsBefore + 测试）
- [x] 2.2 getJobStats 评估——随 2.1 控规模缓解，索引 idx_jobs_status 已覆盖 status，暂不加缓存
- [x] 2.3 collectBatch 消除 N+1（1+2N → 3 条 IN 查询，保序；顺序/缺帖测试）
- [x] 2.4 scrypt memoize（deriveKey 按 secret 缓存派生密钥）
- [x] 3.1 单实例约束文档化（README + SchedulerService 类注释 + .env.example）
- [ ] 3.2 错误返回风格统一（**待定**：test/run 的 200/400+{ok,error} 改抛异常会牵动 web /analyze 调用方，需 web 侧协同）
- [x] 3.3 两条分析路径：保留 CLI 内联 runBatch（离线用），doc + 运行日志标注「绕过队列、勿与 worker 并发」
- [x] 3.4 日志收敛到全局 pino logger（3 处 NestJS Logger → 带 [tag] 前缀的全局 logger）
- [x] 4.1 死代码 / schema 注释（export_locked_at 标「预留」；canceled 标「预留态」）
- [x] 4.2 buildContext 归位（crawler→analyzer，git mv + 改 2 处 import）
- [x] 4.3 配置旁路集中说明（env.ts 注释枚举 WORKER_IN_PROCESS/SETTINGS_SECRET/LOG_DIR/databaseUrl 为何不走 AppEnv）
- [x] 4.4 Worker 参数 env 可配（WORKER_CONCURRENCY/JOB_TIMEOUT_MS/STALE_SECONDS，纳入 AppEnv）
- [x] 4.5 测试补全（+crypto +normalizeInsight；累计 23 个用例）

> 约定：每条改动后跑对应预检查（`typecheck` / 涉及 DB 的跑 `test`）；按主题分组提交（Conventional Commits，中文）。
