/**
 * DI 注入令牌（无副作用、无重依赖）。
 *
 * 单独成文件：repository 等只需引用令牌符号，不应被迫拖入提供方模块的依赖链
 * （否则单测 import 一个 repository 会连带加载 config/dotenv 等）。
 */

/** 整份校验后的应用配置（AppEnv），由 AppConfigModule 提供 */
export const APP_ENV = Symbol('APP_ENV');

/** Prisma 数据库实例（AppDatabase；实为事务感知代理），由 DatabaseModule 提供 */
export const PRISMA = Symbol('PRISMA');

/** 数据库句柄（DbHandle：根客户端 + 关闭函数），由 DatabaseModule 提供给 TxContext / 生命周期 */
export const DB_HANDLE = Symbol('DB_HANDLE');

/** 内嵌执行器并发上限（env.workerConcurrency），由 CoreModule 从 APP_ENV 派生提供 */
export const WORKER_CONCURRENCY = Symbol('WORKER_CONCURRENCY');
