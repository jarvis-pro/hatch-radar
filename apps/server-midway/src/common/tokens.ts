/**
 * DI 注入标识（Midway 用字符串 identifier）。
 *
 * PRISMA / APP_ENV：底层资源。TOK.*：packages/core 装配出的领域实例,在 configuration.onReady 里
 * 用 `registerObject(TOK.x, core.x)` 登记,控制器/守卫以 `@Inject(TOK.x)` 注入
 * （Midway 不支持「按类型注入」未经 @Provide 的纯类,故走字符串令牌——与 PRISMA 同一机制）。
 * 键名与 createCore() 返回对象的键一一对应,便于在配置里循环登记。
 */

/** Prisma 数据库实例（AppDatabase） */
export const PRISMA = 'prisma';
/** 整份校验后的应用配置（AppEnv） */
export const APP_ENV = 'appEnv';

/** core 领域实例的注入令牌（值 = 'core:' + createCore 返回键）。 */
export const TOK = {
  // 仓储
  auditLogs: 'core:auditLogs',
  jobs: 'core:jobs',
  providers: 'core:providers',
  settings: 'core:settings',
  sources: 'core:sources',
  sourceConnectors: 'core:sourceConnectors',
  stats: 'core:stats',
  // 服务
  account: 'core:account',
  admin: 'core:admin',
  data: 'core:data',
  analysisConfig: 'core:analysisConfig',
  runtimeSettings: 'core:runtimeSettings',
  crawlerConfig: 'core:crawlerConfig',
  sync: 'core:sync',
  export: 'core:export',
  deviceAuth: 'core:deviceAuth',
  // 后台
  scheduler: 'core:scheduler',
  gateway: 'core:gateway',
  seedRunner: 'core:seedRunner',
} as const;
