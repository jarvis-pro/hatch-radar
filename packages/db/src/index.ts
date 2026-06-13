/**
 * @hatch-radar/db —— PostgreSQL 主存储层。
 *
 * 导出 Prisma Client（PrismaClient / Prisma 命名空间 / $Enums / 模型类型）、连接工厂、
 * 行类型与 PG⇄域映射。server 读写、web 只读共用；不进 mobile（mobile 仍走 expo-sqlite）。
 */
export * from './generated/prisma/client';
export * from './client';
export * from './types';
export * from './mappers';
