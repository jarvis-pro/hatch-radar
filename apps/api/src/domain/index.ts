/**
 * apps/api 领域桶（domain）：**仅**汇总本 app 自有的领域服务（account / admin / auth / sync / export /
 * sources / settings / translation / worker / pipeline / radar / scheduler / seed）成单一入口。
 *
 * **本 barrel 仅供 wiring 层装配用**（CoreModule 列 provider、控制器 / 守卫 / starter 注入）；领域服务
 * **之间**互引一律走相对路径（如 `../analysis/analysis.service`），**勿**经本 barrel——否则任一服务
 * 改动都让所有 `from '@/domain'` 引用点参与重编译，且滋生 everything-imports-everything 的耦合。
 *
 * 框架无关的能力代码请直接按来源导入，不再经本 barrel 代理转出：
 * - 持久层 / 仓储 / 行类型 / 运行期设置 → `@/database`
 * - AI 分析引擎 / 翻译引擎 / 配置 → `@/lib/analysis`
 * - 采集（reddit/hn/rss/限速/连接器配置）→ `@/lib/crawler`
 * - 鉴权原语（口令 / 会话 / 设备验签）→ `@/auth`
 * - 通用工具 → `@/utils/time`（时间）/ `@/utils/crypto`（密钥加解密）；logger → `@/logger`
 * - 应用配置（AppEnv / loadEnv / env 工具）→ `@/config/env`
 *
 * 本 domain 自有的基础原语（非服务，不进本 barrel，直引具体文件）：领域错误基类 →
 * `@/domain/errors`（DomainError）、任务派发契约 → `@/domain/protocol`（Dispatcher）。
 *
 * 各领域类均为 `@Injectable`，由 CoreModule 列为 provider、Nest 按类型自动注入（已退役 createCore 装配桥）。
 */

// 账户 / 管理 / 设备
export * from './account/auth-context';
export * from './account/account.service';
export * from './admin/admin.service';
export * from './auth/device-context';
export * from './auth/device-auth.service';

// 同步 / 导出
export * from './sync/sync.service';
export * from './export/export.service';
export * from './export/sqlite-writer';
export * from './export/export-query';

// 数据来源 / 采集连接器编排
export * from './sources/sources.service';

// AI 分析编排（模型解析·热重载 / 洞察落库 / 翻译落库——含业务规则与跨仓储编排，故归 domain）
export * from './analysis/analysis-config.service';
export * from './analysis/analysis.service';
export * from './analysis/translation.service';

// 模型 / Key 池 / active 设置编排
export * from './settings/settings.service';
export * from './settings/runtime-settings.service';

// 内容翻译编排
export * from './translation/translation-orchestrator.service';

// 执行器 / 派发 / 编排 / 调度（单进程归一：执行能力内嵌本进程，无独立 worker / WS 网关）
export * from './worker/worker.service';
export * from './worker/collection.executor';
export * from './worker/analyze.executor';
export * from './worker/request-gate';
export * from './worker/local-dispatcher';
export * from './pipeline/pipeline.service';
export * from './pipeline/pipeline-query.service';
export * from './pipeline/task-control.service';
export * from './radar/radar.service';
export * from './radar/blueprint.service';
export * from './radar/process.service';
export * from './scheduler/scheduler.service';

// 种子
export * from './seed/seeder';
export * from './seed/sources.seeder';
export * from './seed/blueprints.seeder';
export * from './seed/processes.seeder';
export * from './seed/super-admin.seeder';
export * from './seed/runtime-settings.seeder';
export * from './seed/seed.runner';
