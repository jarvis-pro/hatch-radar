/**
 * DI 注入令牌（无副作用、无重依赖）。
 *
 * 单独成文件：repository 等只需引用令牌符号，不应被迫拖入提供方模块的依赖链
 * （否则单测 import 一个 repository 会连带加载 config/dotenv 等）。
 */

/** 整份校验后的应用配置（AppEnv），由 AppConfigModule 提供 */
export const APP_ENV = Symbol('APP_ENV');

/** Prisma 数据库实例（AppDatabase），由 DatabaseModule 提供 */
export const PRISMA = Symbol('PRISMA');
