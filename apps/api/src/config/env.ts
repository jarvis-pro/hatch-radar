import { z } from 'zod';

/**
 * 默认 PostgreSQL 连接串（本地 docker-compose，主机映射端口 47432）：运行期 `DATABASE_URL`
 * 缺省时的权威回退默认值。docker-compose / .env.example 的同串与此对齐。
 */
export const DEFAULT_DATABASE_URL = 'postgres://radar:radar@localhost:47432/hatch_radar';

/** HTTP 服务配置（env 推导）：api 用于监听端口。 */
export interface HttpConfig {
  /** 监听端口；绑定 0.0.0.0 供局域网内的移动端访问 */
  port: number;
}

/**
 * `KEY=`（空串 / 纯空白）一律按「未设置」处理：等同把该行注释掉。
 * 用作下方 schema 的 `z.preprocess` 前置，确保空串语义统一。
 */
export function stripEmptyEnv(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }

  return out;
}

/**
 * 用给定 schema 解析 `process.env`，校验失败一次性报告所有缺失 / 非法字段
 * （与裸跑早失败语义一致）。
 */
export function parseEnv<S extends z.ZodTypeAny>(schema: S): z.infer<S> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败，请先 cp .env.example .env 并填写：\n${messages}`);
  }

  return result.data;
}

/**
 * 下列访问器是本模块之外**唯一**该直接触碰 `process.env` 的出口：bootstrap 期（logger，
 * DI 容器尚不存在）与框架无关工具（crypto / cookies）需在 AppEnv 注入前取值，故不经 AppEnv
 * 而经此处集中读取——维持「只有 config/env.ts 读 process.env」这条单一可信源不变量。
 * 它们读取的变量同时由上面的 schema 校验（启动即早失败）、文档化。
 *
 * 一律经 {@link readEnv} 取值，使空串 / 纯空白统一按「未设置」处理（与 {@link stripEmptyEnv} 同口径）。
 */

/** 读单个 env 变量：trim 后空串视为未设置（返回 undefined），与 {@link stripEmptyEnv} 口径一致。 */
function readEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

/** SETTINGS_SECRET 原始值（密钥 AES 加解密用）；未配置返回 undefined。 */
export function settingsSecret(): string | undefined {
  return readEnv('SETTINGS_SECRET');
}

/** 日志级别（pino）；默认 info。 */
export function logLevel(): string {
  return readEnv('LOG_LEVEL') ?? 'info';
}

/** 是否生产环境。 */
export function isProd(): boolean {
  return readEnv('NODE_ENV') === 'production';
}

/**
 * 是否签发 Secure cookie：COOKIE_SECURE 显式覆盖（'true'/'false'）优先，否则回落生产环境。
 * 独立开关杜绝「生产容器忘设 NODE_ENV → 会话 cookie 无 Secure、明文 HTTP 下被嗅探」。
 */
export function cookieSecure(): boolean {
  const override = readEnv('COOKIE_SECURE');
  if (override) {
    return override === 'true';
  }

  return isProd();
}

/**
 * HTTP 服务默认监听端口（47xxx 段避撞常见 dev 端口，…878 呼应旧 8787）。
 */
const DEFAULT_HTTP_PORT = 47878;

/**
 * api 进程 PG 连接池上限下界：服务 HTTP 处理 + 调度。单进程归一后还要喂内嵌执行器的
 * 并发任务，故未显式设 DATABASE_POOL_MAX 时取 max(本下界, WORKER_CONCURRENCY + 5)。
 */
const DEFAULT_API_POOL_MAX = 10;

/**
 * api 进程的 env schema：PG 连接（连接串 / 连接池上限）+ 密钥主密钥 + 控制面自有字段（HTTP
 * 监听端口、首个超管种子）+ 内嵌执行器并发（WORKER_CONCURRENCY）。单进程归一后 worker 不再是
 * 独立进程，其并发与连接池下限合回本进程。
 */
const apiEnvSchema = z.preprocess(
  stripEmptyEnv,
  z
    .object({
      /** 模型密钥加密入库的主密钥（仅校验非空串；真正读取在 crypto） */
      SETTINGS_SECRET: z.string().trim().min(1).optional(),

      /** PostgreSQL 连接串，默认指向本地 docker-compose 的 PG */
      DATABASE_URL: z.string().trim().default(DEFAULT_DATABASE_URL),

      /** PG 连接池上限；不设时由下方 transform 推导（max(下界, 并发 + 5)） */
      DATABASE_POOL_MAX: z.coerce.number().int().min(1).optional(),

      /** HTTP 服务监听端口，默认 47878（DEFAULT_HTTP_PORT）；绑定 0.0.0.0 */
      HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),

      /** 内嵌执行器并发认领数，默认 20，最小 1（纯 env，不入库；影响连接池下限） */
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(20),

      /** 首个超级管理员种子（仅空库时创建；幂等）；不设则跳过种子 */
      SUPER_ADMIN_EMAIL: z.string().trim().toLowerCase().optional(),
      SUPER_ADMIN_PASSWORD: z.string().min(8).optional(),

      /**
       * 跨源放行白名单（逗号分隔 origin）：web SPA 与 api 不同源部署时必填，否则浏览器不带凭据 /
       * 预检被拒。留空＝不开 CORS（同源 / 反代收敛场景，安全默认）。
       */
      CORS_ORIGINS: z.string().trim().optional(),

      /**
       * Express trust proxy 设置（'true' / 代理层数 / 'loopback' 等）：配置后 req.ip 按代理链正确解析，
       * 审计 IP 不再被伪造的 x-forwarded-for 污染。留空＝不信任任何代理（取 socket IP，安全默认）。
       */
      TRUST_PROXY: z.string().trim().optional(),

      /** 运行环境标识；'production' 启用 Secure cookie 默认、关闭 pretty 日志。bootstrap 期经 {@link isProd} 读取。 */
      NODE_ENV: z.string().trim().optional(),
      /** 日志级别（pino）；默认 info。bootstrap 期经 {@link logLevel} 读取。 */
      LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional(),
      /** 是否签发 Secure 会话 cookie（'true'/'false'）；省略则回落 NODE_ENV==='production'。经 {@link cookieSecure} 读取。 */
      COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    })
    .transform((env) => ({
      databaseUrl: env.DATABASE_URL,
      databasePoolMax:
        env.DATABASE_POOL_MAX ?? Math.max(DEFAULT_API_POOL_MAX, env.WORKER_CONCURRENCY + 5),
      http: { port: env.HTTP_PORT } satisfies HttpConfig,
      workerConcurrency: env.WORKER_CONCURRENCY,
      superAdmin:
        env.SUPER_ADMIN_EMAIL && env.SUPER_ADMIN_PASSWORD
          ? { email: env.SUPER_ADMIN_EMAIL, password: env.SUPER_ADMIN_PASSWORD }
          : undefined,
      corsOrigins: env.CORS_ORIGINS
        ? env.CORS_ORIGINS.split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : [],
      trustProxy: env.TRUST_PROXY,
    })),
);

/** api 控制面运行时配置（由 {@link apiEnvSchema} 自动派生）。 */
export type AppEnv = z.infer<typeof apiEnvSchema>;

/**
 * 从环境变量加载并校验 api 配置（校验失败一次性报告所有缺失 / 非法字段）。
 */
export function loadEnv(): AppEnv {
  return parseEnv(apiEnvSchema);
}
