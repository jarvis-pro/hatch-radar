/** DI 注入令牌（单独成文件，避免与 worker.module 形成循环 import）。 */

/** 整份校验后的应用配置（AppEnv） */
export const APP_ENV = Symbol('APP_ENV');

/** Prisma 数据库实例（AppDatabase） */
export const PRISMA = Symbol('PRISMA');
