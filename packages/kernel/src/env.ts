import { z } from 'zod';
import { DEFAULT_DATABASE_URL, DEFAULT_HTTP_PORT } from '@hatch-radar/config';

/** HTTP 服务配置（env 推导） */
export interface HttpConfig {
  /** 监听端口；绑定 0.0.0.0 供局域网内的移动端访问 */
  port: number;
}

/** 分析 worker 池运行参数（env 推导） */
export interface WorkerConfig {
  /** 并发认领的 worker 数 */
  concurrency: number;
}

/**
 * `KEY=`（空串 / 纯空白）一律按「未设置」处理：等同把该行注释掉。
 * 与 NestJS 版 env.ts 行为完全一致（见 apps/api/src/config/env.ts）。
 */
function stripEmptyEnv(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return out;
}

const envSchema = z.preprocess(
  stripEmptyEnv,
  z
    .object({
      /** 分析 worker 并发数，默认 2，最小 1（纯 env，不入库） */
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),

      /** 模型密钥加密入库的主密钥 */
      SETTINGS_SECRET: z.string().trim().min(1).optional(),

      /** PostgreSQL 连接串，默认指向本地 docker-compose 的 PG */
      DATABASE_URL: z.string().trim().default(DEFAULT_DATABASE_URL),
      /** PG 连接池上限；默认 max(10, WORKER_CONCURRENCY+5) */
      DATABASE_POOL_MAX: z.coerce.number().int().min(1).optional(),

      /** HTTP 服务监听端口，默认 47878（DEFAULT_HTTP_PORT）；绑定 0.0.0.0 */
      HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),

      /** 首个超级管理员种子（仅空库时创建；幂等）；不设则跳过种子 */
      SUPER_ADMIN_EMAIL: z.string().trim().toLowerCase().optional(),
      SUPER_ADMIN_PASSWORD: z.string().min(8).optional(),

      /** worker 进程连接 gateway 的 WebSocket 地址；不设则自动推导为 ws://localhost:<HTTP_PORT>/ws/worker */
      GATEWAY_URL: z.string().trim().optional(),
    })
    .transform((env) => ({
      databaseUrl: env.DATABASE_URL,
      databasePoolMax: env.DATABASE_POOL_MAX ?? Math.max(10, env.WORKER_CONCURRENCY + 5),
      http: { port: env.HTTP_PORT } satisfies HttpConfig,
      gatewayUrl: env.GATEWAY_URL,
      superAdmin:
        env.SUPER_ADMIN_EMAIL && env.SUPER_ADMIN_PASSWORD
          ? { email: env.SUPER_ADMIN_EMAIL, password: env.SUPER_ADMIN_PASSWORD }
          : undefined,
      worker: { concurrency: env.WORKER_CONCURRENCY } satisfies WorkerConfig,
    })),
);

/** 应用运行时所需的全量配置，由 envSchema 自动派生 */
export type AppEnv = z.infer<typeof envSchema>;

/** PostgreSQL 连接串单独暴露：CLI / 迁移脚本不需要任何业务凭据 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

/**
 * 从环境变量加载并校验应用配置（校验失败一次性报告所有缺失/非法字段）。
 * 与 NestJS 版语义一致。
 */
export function loadEnv(): AppEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败，请先 cp .env.example .env 并填写：\n${messages}`);
  }
  return result.data;
}
