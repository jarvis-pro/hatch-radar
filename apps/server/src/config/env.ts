import { z } from 'zod';
import { DEFAULT_DATABASE_URL, DEFAULT_HTTP_PORT } from '@hatch-radar/config';

/** 局域网导出/同步 HTTP 服务配置（env 推导） */
export interface HttpConfig {
  /** 监听端口；绑定 0.0.0.0 供局域网内的移动端访问 */
  port: number;
  /** 可选访问令牌；设置后导出与同步接口要求 `Authorization: Bearer <token>` */
  token?: string;
}

/** 分析 worker 池运行参数（env 推导） */
export interface WorkerConfig {
  /** 并发认领的 worker 数 */
  concurrency: number;
  /** 单 job 硬超时（毫秒） */
  jobTimeoutMs: number;
  /** running 心跳超时回收阈值（秒） */
  staleSeconds: number;
}

/**
 * `KEY=`（空串 / 纯空白）一律按「未设置」处理：等同把该行注释掉。
 * 这样 .env 里取消注释但留空（如 `SETTINGS_SECRET=`）不会触发 `min(1)` 校验失败导致启动崩——
 * 可选项回落到 undefined、带默认值的项回落到默认值，符合「空环境变量即未配置」的惯例。
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
      // ── 数据来源 / Reddit 凭据 ─────────────────────────────────────────
      // 监控哪些来源、Reddit 采集凭据一律在设置页 /settings 配置入库
      // （sources / source_connectors，见 docs/runtime-config-design.md）。env 不再承载。

      // ── AI 分析调优 ───────────────────────────────────────────────────
      // 模型接入（厂商 / 密钥 / 模型名 / base_url）一律在设置页 /settings 配置入库，
      // env 不再承载任何模型密钥（见 docs/runtime-config-design.md §3.4）。此处仅留批次/并发调优。

      /** 每轮 AI 分析的帖子批次上限，默认 20，最小 1 */
      ANALYZE_BATCH_SIZE: z.coerce.number().int().min(1).default(20),

      /** 分析 worker 并发数，默认 2，最小 1（扩容时调大；独立 worker 进程同样读此值） */
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
      /** 单个分析 job 的硬超时（毫秒），默认 600000，最小 1000 */
      WORKER_JOB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(600_000),
      /** running 心跳超时回收阈值（秒），默认 300，最小 30（须大于内部心跳间隔 15s） */
      WORKER_STALE_SECONDS: z.coerce.number().int().min(30).default(300),

      /** 模型密钥加密入库的主密钥；在设置页配置模型须先设置它（建议 openssl rand -hex 32） */
      SETTINGS_SECRET: z.string().trim().min(1).optional(),

      // ── 存储 ─────────────────────────────────────────────────────────

      /** PostgreSQL 连接串，默认指向本地 docker-compose 的 PG */
      DATABASE_URL: z.string().trim().default(DEFAULT_DATABASE_URL),
      /** PG 连接池上限；默认 max(10, WORKER_CONCURRENCY+5)，扩 worker 并发时随之放大，避免连接饥饿 */
      DATABASE_POOL_MAX: z.coerce.number().int().min(1).optional(),

      // ── 导出服务（局域网 HTTP，供移动端拉取批次）──────────────────────

      /** 导出 HTTP 服务监听端口，默认 47878（DEFAULT_HTTP_PORT）；绑定 0.0.0.0 */
      HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),
      /** 可选访问令牌；设置后导出接口要求 Authorization: Bearer <token> */
      API_TOKEN: z.string().trim().min(1).optional(),

      /** worker 进程连接 gateway 的 WebSocket 地址；不设则自动推导为 ws://localhost:<HTTP_PORT>/ws/worker */
      GATEWAY_URL: z.string().trim().optional(),
    })
    .transform((env) => ({
      analyzeBatchSize: env.ANALYZE_BATCH_SIZE,
      databaseUrl: env.DATABASE_URL,
      databasePoolMax: env.DATABASE_POOL_MAX ?? Math.max(10, env.WORKER_CONCURRENCY + 5),
      http: { port: env.HTTP_PORT, token: env.API_TOKEN } satisfies HttpConfig,
      gatewayUrl: env.GATEWAY_URL,
      worker: {
        concurrency: env.WORKER_CONCURRENCY,
        jobTimeoutMs: env.WORKER_JOB_TIMEOUT_MS,
        staleSeconds: env.WORKER_STALE_SECONDS,
      } satisfies WorkerConfig,
    })),
);

/** 应用运行时所需的全量配置，由 envSchema 自动派生 */
export type AppEnv = z.infer<typeof envSchema>;

/**
 * 注：少数 env 变量刻意不经 AppEnv，因为须在 DI 容器就绪前或在纯模块中读取——这是有意为之，非遗漏：
 * - WORKER_IN_PROCESS：在 AppModule 模块定义期决定是否 import WorkerModule（早于 DI）
 * - SETTINGS_SECRET：仅 crypto.ts（纯模块、无 DI）按需读取，不下放到处处可见的 AppEnv
 * - LOG_LEVEL / NODE_ENV：logger.ts 在 bootstrap 之前就要初始化
 * - {@link databaseUrl}：CLI / 迁移脚本的轻量路径，不构建完整 AppEnv
 *
 * 这些在 DI / ConfigModule 之前读取的变量，靠启动脚本的 `node --env-file-if-exists=.env`
 * 把 .env 注入 process.env（早于任何模块求值），故写在 .env 文件里同样生效——不必额外 export。
 */

/** PostgreSQL 连接串单独暴露：CLI / 迁移脚本不需要任何业务凭据 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

/**
 * 从环境变量加载并校验应用配置。
 * - 数据来源 / Reddit 凭据 / 模型接入均不再读 env：一律在设置页 /settings 配置入库
 *   （sources / source_connectors / model_providers，见 docs/runtime-config-design.md）
 * - 校验失败时一次性报告所有缺失/非法字段
 * @returns 校验通过的应用配置对象
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
