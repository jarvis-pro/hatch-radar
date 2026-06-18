/**
 * @hatch-radar/db —— PostgreSQL 主存储层。
 *
 * 导出 Prisma Client（PrismaClient / Prisma 命名空间 / $Enums / 模型类型）、连接工厂、
 * 行类型与 PG⇄域映射。server 读写、web 只读共用；不进 mobile（mobile 仍走 expo-sqlite）。
 */
// 内部基础桶（client + 类型 + 映射 + 生成的 Prisma）；仓储经 ../internal 相对引用，避免自引循环
export * from './internal';

// 仓储（领域数据访问层；构造注入 AppDatabase）
export * from './repositories/audit-logs.repository';
export * from './repositories/comments.repository';
export * from './repositories/device-credentials.repository';
export * from './repositories/device-enrollments.repository';
export * from './repositories/insights.repository';
export * from './repositories/job-steps.repository';
export * from './repositories/jobs.repository';
export * from './repositories/login-attempts.repository';
export * from './repositories/posts.repository';
export * from './repositories/providers.repository';
export * from './repositories/sessions.repository';
export * from './repositories/settings.repository';
export * from './repositories/source-connectors.repository';
export * from './repositories/sources.repository';
export * from './repositories/stats.repository';
export * from './repositories/translations.repository';
export * from './repositories/users.repository';

// 运行期设置服务（settings 仓储之上的读写）
export * from './runtime-settings.service';

// 消歧：SourcePlatform 在 sources / source-connectors 两仓储同名导出，显式以 sources 为准
export type { SourcePlatform } from './repositories/sources.repository';
