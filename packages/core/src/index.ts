/**
 * @hatch-radar/core —— 框架无关的领域核心。
 * api / worker 两端（及 NestJS / MidwayJS 两框架）统一从此导入领域类型与实现，
 * 用 {@link createCore} 拿到装配好的全套实例，再各自登记进各框架的 IoC 容器。
 */

// 装配工厂 + 通用
export { createCore, type Core } from './factory';
export { DomainError } from './errors';
export { logger } from './logger';

// 配置 / 运行期设置
export * from './config/env';
export * from './config/runtime-settings.service';

// 仓储
export * from './db/audit-logs.repository';
export * from './db/comments.repository';
export * from './db/device-credentials.repository';
export * from './db/device-enrollments.repository';
export * from './db/insights.repository';
export * from './db/jobs.repository';
export * from './db/login-attempts.repository';
export * from './db/posts.repository';
export * from './db/providers.repository';
export * from './db/sessions.repository';
export * from './db/settings.repository';
export * from './db/source-connectors.repository';
export * from './db/sources.repository';
export * from './db/stats.repository';
export * from './db/users.repository';

// 账户 / 管理 / 设备
export * from './account/auth-context';
export * from './account/account.service';
export * from './admin/admin.service';
export * from './auth/device-context';
export * from './auth/device-auth.service';

// 数据浏览
export * from './data/data.service';
export * from './data/query-parse';

// 分析
export * from './analysis/analysis.service';
export * from './analysis/analysis-config.service';

// 采集（仅连接器配置服务对外；reddit/hn/rss/queue 为 core 内部）
export * from './crawler/crawler-config.service';

// 同步 / 导出
export * from './sync/sync.service';
export * from './export/export.service';
export * from './export/sqlite-writer';

// 网关协议 / 网关 / 调度 / worker 执行
export * from './gateway/protocol';
export * from './gateway/gateway.service';
export * from './scheduler/scheduler.service';
export * from './worker/worker.service';
export * from './worker/worker-agent';

// 种子
export * from './seed/seeder';
export * from './seed/sources.seeder';
export * from './seed/super-admin.seeder';
export * from './seed/runtime-settings.seeder';
export * from './seed/seed.runner';

// 工具
export * from './utils/time';
export * from './utils/crypto';

// 鉴权原语（转出 @hatch-radar/auth,供建号 / 工具脚本直接使用；领域服务内部亦用之）
export { hashPassword, verifyPassword } from '@hatch-radar/auth';

// 消歧：SourcePlatform 在 sources / source-connectors 两个仓储里同名导出，显式以 sources 为准
export type { SourcePlatform } from './db/sources.repository';
