import { z } from 'zod';
import { baseEnvShape, parseEnv, stripEmptyEnv, type HttpConfig } from '@/lib/kernel';

/**
 * HTTP 服务默认监听端口（47xxx 段避撞常见 dev 端口，…878 呼应旧 8787）。原属
 * `@hatch-radar/config`，worker 退役后只剩 api 消费，故就近落在 api。
 */
const DEFAULT_HTTP_PORT = 47878;

/**
 * api 进程 PG 连接池上限下界：服务 HTTP 处理 + 调度。单进程归一后还要喂内嵌执行器的
 * 并发任务，故未显式设 DATABASE_POOL_MAX 时取 max(本下界, WORKER_CONCURRENCY + 5)。
 */
const DEFAULT_API_POOL_MAX = 10;

/**
 * api 进程的 env schema：共享基础字段（{@link baseEnvShape}）+ 控制面自有字段（HTTP 监听端口、
 * 首个超管种子）+ 内嵌执行器并发（WORKER_CONCURRENCY）。单进程归一后 worker 不再是独立进程，
 * 其并发与连接池下限合回本进程。
 */
const apiEnvSchema = z.preprocess(
  stripEmptyEnv,
  z
    .object({
      ...baseEnvShape,

      /** HTTP 服务监听端口，默认 47878（DEFAULT_HTTP_PORT）；绑定 0.0.0.0 */
      HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),

      /** 内嵌执行器并发认领数，默认 20，最小 1（纯 env，不入库；影响连接池下限） */
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(20),

      /** 首个超级管理员种子（仅空库时创建；幂等）；不设则跳过种子 */
      SUPER_ADMIN_EMAIL: z.string().trim().toLowerCase().optional(),
      SUPER_ADMIN_PASSWORD: z.string().min(8).optional(),
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
