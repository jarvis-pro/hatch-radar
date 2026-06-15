import { z } from 'zod';
import { DEFAULT_HTTP_PORT } from '@hatch-radar/config';
import { baseEnvShape, parseEnv, stripEmptyEnv, type HttpConfig } from '@hatch-radar/kernel';

/**
 * api 控制面进程默认 PG 连接池上限：服务 HTTP 处理 + 调度 + 网关，
 * 与数据面 worker 的并发解耦（不再由 WORKER_CONCURRENCY 推导）。
 */
const DEFAULT_API_POOL_MAX = 10;

/**
 * api 控制面进程的 env schema：共享基础字段（{@link baseEnvShape}）+ 控制面自有字段
 * （HTTP 监听端口、首个超管种子）。worker 专属的网关 / 并发项不在此声明，各自维护。
 */
const apiEnvSchema = z.preprocess(
  stripEmptyEnv,
  z
    .object({
      ...baseEnvShape,

      /** HTTP 服务监听端口，默认 47878（DEFAULT_HTTP_PORT）；绑定 0.0.0.0 */
      HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),

      /** 首个超级管理员种子（仅空库时创建；幂等）；不设则跳过种子 */
      SUPER_ADMIN_EMAIL: z.string().trim().toLowerCase().optional(),
      SUPER_ADMIN_PASSWORD: z.string().min(8).optional(),
    })
    .transform((env) => ({
      databaseUrl: env.DATABASE_URL,
      databasePoolMax: env.DATABASE_POOL_MAX ?? DEFAULT_API_POOL_MAX,
      http: { port: env.HTTP_PORT } satisfies HttpConfig,
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
