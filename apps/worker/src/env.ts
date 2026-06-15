import { z } from 'zod';
import { DEFAULT_HTTP_PORT } from '@hatch-radar/config';
import { baseEnvShape, parseEnv, stripEmptyEnv, type HttpConfig } from '@hatch-radar/kernel';

/** 分析 worker 池运行参数（env 推导）。 */
interface WorkerConfig {
  /** 并发认领的 worker 数 */
  concurrency: number;
}

/**
 * 数据面 worker 进程的 env schema：共享基础字段（{@link baseEnvShape}）+ 数据面自有字段
 * （并发数、网关地址）。`HTTP_PORT` 仅用于在未显式设置 `GATEWAY_URL` 时推导默认网关地址，
 * 单机部署可随 api 端口自动对齐；api 专属的超管种子项不在此声明。
 */
const workerEnvSchema = z.preprocess(
  stripEmptyEnv,
  z
    .object({
      ...baseEnvShape,

      /** 分析 worker 并发认领数，默认 2，最小 1（纯 env，不入库；影响连接池下限） */
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),

      /** api 监听端口；仅用于推导默认网关地址，默认 47878（DEFAULT_HTTP_PORT） */
      HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),

      /** 连 gateway 的 WebSocket 地址；不设则推导为 ws://localhost:<HTTP_PORT>/ws/worker */
      GATEWAY_URL: z.string().trim().optional(),
    })
    .transform((env) => ({
      databaseUrl: env.DATABASE_URL,
      databasePoolMax: env.DATABASE_POOL_MAX ?? Math.max(10, env.WORKER_CONCURRENCY + 5),
      http: { port: env.HTTP_PORT } satisfies HttpConfig,
      gatewayUrl: env.GATEWAY_URL,
      worker: { concurrency: env.WORKER_CONCURRENCY } satisfies WorkerConfig,
    })),
);

/** 数据面 worker 运行时配置（由 {@link workerEnvSchema} 自动派生）。 */
export type AppEnv = z.infer<typeof workerEnvSchema>;

/**
 * 从环境变量加载并校验 worker 配置（校验失败一次性报告所有缺失 / 非法字段）。
 */
export function loadEnv(): AppEnv {
  return parseEnv(workerEnvSchema);
}
