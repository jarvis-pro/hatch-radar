import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { version } from '@/../package.json';

const TAG_ACCOUNT = `鉴权权威端点，负责人工账户的登录、会话管理与个人资料维护。

**登录流程**
1. \`POST /api/auth/login\` — 提交邮箱 + 口令，返回 \`{ user, token }\`
2. 客户端将 token 存入 \`localStorage\`，后续请求通过 \`Authorization: Bearer <token>\` 携带
3. \`GET /api/auth/session\` — SPA 进站时调用一次，取当前用户态

**会话管理**
- 可查看本账户的全部活跃会话并逐个撤销，或一键登出其余所有设备
- 改密后当前以外的会话自动失效`;

const TAG_ADMIN = `超管专属端点，负责平台用户的增删改查与操作审计。

**用户管理**
- 创建 / 修改 / 禁用账户，重置任意用户口令
- 调整用户状态（\`active\` / \`disabled\`）

**审计日志**
- 查询所有账户的操作记录（登录、改密、鉴权失败等）
- 支持按时间、操作类型、操作人筛选

> 本组所有接口均需 **super_admin** 角色，普通 admin 调用返回 403。`;

const TAG_RADAR = `核心业务读写端点，覆盖图纸定义、进程调度与结果查阅三层。

**图纸（Blueprints）** \`/api/blueprints/*\`
定义抓取规则：数据来源、关键词、频率、分析模型。图纸是进程的模板，修改图纸不影响已在运行的进程。

**进程（Processes）** \`/api/processes/*\`
图纸的运行实例，可独立暂停 / 续跑 / 手动触发，查询各进程的运行历史。

**指挥室 & 数据** \`/api/radar/*\`
- \`GET /api/radar/control-room\` — 全局概览（各进程状态、队列深度）
- \`GET /api/radar/insights\` — 洞察列表，支持多维筛选
- \`GET /api/radar/posts\` — 原始帖子库`;

const TAG_PIPELINE = `任务队列的手动触发与运行监控端点。

**触发任务**
- \`POST /api/pipeline/collect\` — 按指定来源立即触发一次采集（抓新帖）
- \`POST /api/pipeline/recheck\` — 对旧帖触发一次复查（更新评论数 / 重新分析）

**队列监控**
- \`GET /api/pipeline/inflight\` — 查看当前进行中的任务（任务 id、状态、耗时）
- \`GET /api/pipeline/runs\` — 历史运行记录

**任务控制**
对单个任务执行 resume / run-to-end / retry / cancel，或对指定 stage 开关 gate（用于检视器暂停点）。`;

const TAG_ANALYSIS = `单帖逐节点检视器，用于调试分析流水线或对指定帖子手动触发精细化分析。

**6 个节点**：\`resolve → fetch → context → ai_call → normalize → persist\`

每个节点执行后落检查点；\`step_gate\` 开启时节点完成后自动暂停，续跑靠重新认领——执行器始终无状态。

**操作接口**
- \`POST /api/analysis/inspect\` — 触发检视，返回 \`jobId\`
- \`GET  /api/analysis/inspect/:jobId\` — 查询当前节点与各步骤状态
- resume / run-to-end / retry-step / cancel — 控制检视进度

> \`ai_call\` 节点唯一不可重算，失败须用 retry-step 重试而非重新触发。`;

const TAG_SETTINGS = `运行期配置管理，所有凭据加密存储（AES-256-GCM），API 只返回脱敏值。

**AI 提供商** \`/api/settings/providers/*\`
支持 \`anthropic\` / \`openai\` / \`deepseek\` / \`claude_cli\` 四种。每个提供商可挂多把 API Key，Key 状态机：\`active → cooling（429）→ invalid（401/403）\`，自动故障转移。

**运行期参数** \`/api/settings/runtime\`
- 当前激活的分析模型与翻译提供商
- 采集频率、并发上限等调优参数

> 未配置 \`SETTINGS_SECRET\` env 时，密钥相关功能禁用，提供商列表返回空。`;

const TAG_SOURCES = `数据来源与平台连接器管理。

**来源（Sources）** \`/api/sources/*\`
定义抓取目标：Reddit subreddit、Hacker News、RSS Feed 等。每条来源关联一个连接器，决定如何鉴权与限速。

**连接器（Source Connectors）** \`/api/source-connectors/*\`
平台级抓取配置（API 凭据 / 代理 / User-Agent）。
- \`POST /api/source-connectors/:id/test\` — 连通性测试，返回首批原始数据供验证

> Reddit 须先在连接器里配置 Cookie 凭据（官方 API 已停止免费发放），HN 与 RSS 无需鉴权。`;

const TAG_DASHBOARD = `价值看板数据端点，聚合采集 → 分析 → 洞察漏斗指标与每日趋势。

- \`GET /api/dashboard?range=\` — 一次性返回完整看板数据（\`all\` / \`today\` / \`7d\` / \`30d\`）
  - 价值漏斗：帖子总数 → 已分析 → 洞察产出
  - 每日趋势：按天统计洞察数与成本
  - 洞察质量：强度分布 / 标签分布
  - 来源洞察力：各来源的产出效率
  - ROI：每条洞察平均成本（API Key 模式）

> 运营指标（队列深度 / Worker 状态 / 吞吐）在指挥室 \`GET /api/radar/control-room\`。`;

const TAG_EXPORT = `数据导出端点，将洞察批次以 JSON 格式输出供外部消费。

- \`GET /api/export/batch\` — 按条件导出洞察批次
  - 查询参数：\`since\`（起始时间戳）/ \`minIntensity\`（最低强度）/ \`subreddit\` / \`limit\`

> 需 \`export:run\` 权限。`;

const TAG_REQUESTS = `出站请求闸控制台，监控并限速所有外部 HTTP 请求（抓取 / AI 调用）。

**Lane 概览** \`GET /api/requests\`
返回各 lane 的速率（请求/分钟）、暂停状态、在途数与近 1 小时完成数，以及最近 80 条请求明细。

**Lane 控制**
- \`POST /api/requests/lanes/:lane/pause\` — 暂停指定 lane，Worker 采集阻塞至恢复
- \`POST /api/requests/lanes/:lane/resume\` — 恢复指定 lane

> 需 \`requests:control\` 权限。`;

const TAG_HEALTH = `健康检查端点，供负载均衡器探活或未登录用户快速确认服务状态。

- \`GET /api/health\` — 返回 \`{ ok, now, stats }\`
  - \`ok\`: 服务正常为 \`true\`
  - \`now\`: 当前服务器时间（epoch 秒）
  - \`stats\`: 数据概览（帖子数 / 洞察数 / 分析任务数）

> **@Public** — 无需鉴权，可直接访问。`;

const API_DESCRIPTION = `## 快速开始

1. 调用 \`POST /api/auth/login\` 获取 token
2. 点击右上角 **Authenticate**，填入 Bearer token
3. 所有接口即可直接调用（token 刷新后自动保留）

## 鉴权

除 \`POST /api/auth/login\` 外，所有接口均需携带：

\`\`\`
Authorization: Bearer <token>
\`\`\`

## 本地地址

\`http://localhost:47878\``;

const TAG_TRANSLATIONS = `内容翻译管线端点，译文按源内容哈希缓存，同内容不重复翻译。

**触发翻译**
- \`POST /api/translations/posts/:id\` — 对指定帖子（标题 + 评论）触发翻译，异步入队
- \`POST /api/translations/batch\` — 批量触发，适合补量场景

**查询**
- \`GET /api/translations/posts/:id\` — 取指定帖子的译文摘要
- \`GET /api/translations/posts/:id/content\` — 取完整译文内容
- \`GET /api/translations/coverage\` — 库级翻译覆盖率统计
- \`GET /api/translations/usage\` — 翻译用量（字符数 / 费用，API Key 模式）

**提供商**：\`claude_cli\`（订阅模式，高质量零边际）/ \`azure\`（机翻，按字符计费）`;

/**
 * 挂载交互式 API 文档（Scalar）于 `/docs`，仅非生产环境——避免对外泄露完整接口目录。
 *
 * 文档内的操作路径默认带全局前缀 `/api`（`ignoreGlobalPrefix` 默认 false），故 "Try it out"
 * 直接命中真实路由。调试流程：先执行 POST /api/auth/login 拿到 token，再点 Authenticate 填入即可。
 *
 * 注：本仓直跑 TS 源（`@swc-node/register`、无 `nest build`），swagger 自动内省插件挂不上。请求体
 * 由 nestjs-zod 从 zod schema 自动出 schema（`@Body() dto: XxxDto` = createZodDto 类），
 * createDocument 后经 `cleanupOpenApiDoc` 把 zod 占位清理成正规 OpenAPI（无需 CLI 内省插件）。
 */
export function mountApiDocs(app: NestExpressApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Hatch Radar API')
    .setDescription(API_DESCRIPTION)
    .setVersion(version)
    .addBearerAuth()
    .addTag('account', TAG_ACCOUNT)
    .addTag('admin', TAG_ADMIN)
    .addTag('radar', TAG_RADAR)
    .addTag('pipeline', TAG_PIPELINE)
    .addTag('analysis', TAG_ANALYSIS)
    .addTag('settings', TAG_SETTINGS)
    .addTag('sources', TAG_SOURCES)
    .addTag('dashboard', TAG_DASHBOARD)
    .addTag('export', TAG_EXPORT)
    .addTag('requests', TAG_REQUESTS)
    .addTag('health', TAG_HEALTH)
    .addTag('translations', TAG_TRANSLATIONS)
    .build();
  // createZodDto 生成的 DTO 类带 _OPENAPI_METADATA_FACTORY，SwaggerModule 运行期即可读出 schema（绕过无 nest
  // build 时 swc 内省插件挂不上的限制）；createDocument 后经 cleanupOpenApiDoc 把 zod 占位清理成正规 OpenAPI schema。
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  // 全局声明 Bearer 鉴权：所有端点默认需要 Authorization: Bearer <token>。
  document.security = [{ bearer: [] }];
  app.use(
    '/docs',
    apiReference({
      spec: { content: document },
      persistAuth: true,
      hiddenClients: true,
    }),
  );
}
