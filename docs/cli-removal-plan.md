# CLI 移除与导出能力前移计划

> 移除 `apps/server` 的 CLI 子系统（`insights` / `analyze` / `export` 三命令）。
> 三者的能力已在 server 的 HTTP 层 / web 中覆盖，或可低成本补齐——CLI 只是同一套服务的
> **并行第二入口**，非独立价值来源。删除不损失任何业务逻辑，同时消除一处绕队列的脚枪。
>
> 本计划**修订**既有评审 `server-design-review-plan.md` 第 3.3 条「保留 CLI 内联 runBatch（离线用）」
> 的决定，理由见第三节。
>
> 范围：`apps/server/src/cli/**`、两处 `package.json` 脚本、`README.md`、若干注释、`AnalysisService.runBatch`。

## 一、动机

- **冗余入口**：`CliModule` 复用 `AnalysisModule` / `ExportModule` 的同一批服务与仓储，是与 HTTP/worker 平行的第二个 composition root，不产生新能力。
- **能力已在别处**：三命令全部已被 HTTP 控制器 / web 页面覆盖，或仅差一个前端入口（见第二节）。
- **删除零业务损失**：被删的只有 CLI 的 arg 解析与打印逻辑；`ExportService` / `sqlite-writer` / `AnalysisService.analyzeAndPersist` 等全部由 HTTP 路径继续复用。
- **顺带除雷**：`analyze` 的内联 `runBatch` 绕过任务队列，与运行中的 worker 竞争同批帖子（其自身注释即警告「勿与 worker 并发」）。移除它正好以最干净的方式达成评审 3.3 的「单一分析路径」目标。
- **维护腐烂风险**：CLI 无任何测试覆盖，是 refactor 时静默失效却无人察觉的典型（如本次 `logger.ts → logger/index.ts` 迁移就需手动跟着改 CLI import）。

## 二、现状对照（删除的依据）

| CLI 命令   | 行为                                 | 既有等价物                                                                                                  | 结论                                              |
| ---------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `insights` | 检索并打印已落库洞察                 | web `/insights/[id]` 页面 + web 直读 PG                                                                     | **纯冗余**，删                                    |
| `analyze`  | 内联跑一轮、**绕过队列**             | HTTP `POST /api/analysis/run`（入队走 worker）+ web `/analyze` 页 + `/api/analysis/run` 代理                | 触发能力已在 web；内联绕队列是脚枪，删            |
| `export`   | 收集有效批次写本地 `.sqlite`/`.json` | HTTP `GET /api/export/batch`（JSON）+ `GET /api/export/batch.sqlite`（`StreamableFile` 流式下载，逻辑同源） | **后端已就绪**，web 仅差一个下载入口（见 Step 1） |

> mobile 不依赖 CLI——它走 `/api/export/*`（取批次）与 `/api/sync/push`（回写）。CLI `export` 纯粹是「人在终端落本地文件」的便利，无下游依赖。

## 三、与既有评审 3.3 的关系

`server-design-review-plan.md` 第 3.3 条「两条分析路径收敛」当时的结论是：

> **保留 CLI 内联 runBatch（离线用），doc + 运行日志标注「绕过队列、勿与 worker 并发」**

本计划**修订**该决定为「移除」，依据：

- 当时保留的唯一理由是「离线/server 停机时用」（break-glass）。如今 `export` 与 `analyze` 触发**都已在 HTTP/web** 落地，离线兜底需求由 `curl` HTTP 端点、`psql`、以及 server 内已装的 `@nestjs/schedule`（定时任务应写在进程内，而非系统 cron 调 CLI）覆盖。
- 「标注警告但保留脚枪」不如「移除脚枪」：保留就意味着整套 CLI 入口与绕队列路径一直在。
- 移除后 `runBatch` 这条旁路彻底消失，3.3 追求的「单一分析路径」以最干净方式达成——本计划视为 3.3 的最终收口。

## 四、取舍（需有意识接受）

1. **无浏览器的破窗运维**。云端无头机上，CLI 是不开 web、不带 token 也能戳库/拉数的零依赖手段。
   - 缓解：`curl` 带 Bearer 打 `/api/export/*`、`/api/analysis/*`；或直接 `psql`。定时导出用 `@nestjs/schedule`。
2. **内联 `analyze` 绕队列**消失。
   - 这本就是脚枪（破坏单写者假设），删除为**正收益**，无需缓解。

## 五、落地步骤

> 顺序刻意让 Step 1 先于 Step 2：先把 `export` 的前端入口补上，确保任何用户可见能力在过程中**不出现空窗**（`insights`/`analyze` 触发本已在 web）。

### Step 1 — web 补齐「导出批次」入口

- **后端已完工**：`ExportController`（`@UseGuards(BearerAuthGuard)`）已暴露 `GET /api/export/batch` 与 `GET /api/export/batch.sqlite`。
- **web 改动**：照现有 `/api/analysis/run` 的 `serverApiFetch` 代理模式，新增一个 web 路由把 server 的 `StreamableFile` 流式转回浏览器（server 持 Bearer token，web 仅服务端代理）；前端加一个带筛选条件（`since`/`days`/`minIntensity`/`subreddit`/`limit`）的「导出批次」入口。
- **入口位置**：建议放在 insights 列表 / 首页工作台。
- **验收**：web 点击可下载到与原 CLI **同条件、同字节**的 `.sqlite`/`.json`（因复用 server 同源 `sqlite-writer`，产物天然一致）。

### Step 2 — 移除 CLI + 清理

- **删文件**：`apps/server/src/cli/main.ts`、`apps/server/src/cli/cli.module.ts`（整个 `cli/` 目录）。
- **删脚本**：根 `package.json` 的 `"cli"`；`apps/server/package.json` 的 `"cli"`。
- **删死代码**：`AnalysisService.runBatch`（仅 CLI 调用；核对 `AnalysisStats` 类型其它引用后决定该类型去留）。
- **改文档**（`README.md`）：
  - 「文件导出」段（约 138–144 行）的 `pnpm cli export …` 示例改写为 web 导出说明。
  - insights 示例段（约 303–311 行）删除或改为 web 查看。
  - 目录树注释（约 235 行）去掉 `cli/` 行。
- **改注释**：`scheduler.service.ts:69`「查看洞察: pnpm cli insights」改为 web；`analysis.service.ts` 中 `runBatch` 的注释随方法一并删。
- **不动**：`apps/mobile/eas.json` 的 `"cli"`（EAS CLI 配置，与本项目 CLI 无关）。

## 六、影响面

| 类别 | 内容                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 删除 | `apps/server/src/cli/`（2 文件）、两处 `package.json` `"cli"` 脚本、`AnalysisService.runBatch`               |
| 新增 | web 导出路由 + 「导出批次」前端入口（Step 1）                                                                |
| 修改 | `README.md`（导出/查看示例、目录树）、`scheduler.service.ts` 注释                                            |
| 保留 | `ExportModule` / `ExportService` / `sqlite-writer`、`AnalysisModule` / `analyzeAndPersist`、全部 HTTP 控制器 |
| 不动 | `apps/mobile/eas.json` `"cli"`（EAS，无关）                                                                  |

## 七、验收

- `pnpm -r typecheck` 与 `pnpm lint` 全绿。
- `grep -rn "pnpm cli\|CliModule\|runBatch" apps packages --include='*.ts' --include='*.json'`（排除构建产物）只剩 `eas.json` 的无关项，或为 0。
- `grep -in "pnpm cli" README.md` 为 0。
- web 导出产物与原 CLI 字节级一致（同源 `sqlite-writer`）。
- 本次改动**单独成一个 commit 组**，不与在飞的 logger refactor 混提（review/回滚干净）。

## 八、推进顺序与状态

- [x] Step 1 — 新增 `apps/web/src/app/api/export/route.ts`（**流式**代理，保留下载响应头，不复用写死 JSON 的 proxyToServer）+ `components/export-batch.tsx`（Popover 筛选表单，挂首页顶部）；web typecheck 通过
- [x] Step 2.1 — 删 `apps/server/src/cli/`（main.ts + cli.module.ts）
- [x] Step 2.2 — 删根 + `apps/server` 的 `"cli"` 脚本
- [x] Step 2.3 — 删 `AnalysisService.runBatch`；连带清掉随之孤儿的 `posts`/`comments` 注入与 import，及 `analyzer/analyze.ts` 的 `AnalysisStats` 接口（仓储方法 worker/analysis-config 仍用，保留）
- [x] Step 2.4 — `README.md`「文件导出」改 web「导出批次」、「检索洞察」改 web 浏览、目录树去 `cli/`、脚本约定去 `cli`
- [x] Step 2.5 — `scheduler.service.ts` 初始化日志改「web 控制台查看」；`analysis.service.ts` 类注释去 CLI（runBatch 注释随方法删）
- [x] 收尾 — `pnpm -r typecheck`（7/7）与 `pnpm lint` 全绿；`grep` 残留为 0（仅 `eas.json` 的无关 `cli` 键）；待单独成 commit 组

> 约定：每条改动后跑对应预检查（`typecheck`/涉及 DB 的跑 `test`）；按主题分组提交（Conventional Commits，中文）。
