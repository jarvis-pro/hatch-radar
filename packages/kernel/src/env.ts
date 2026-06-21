import { z } from 'zod';

/**
 * 默认 PostgreSQL 连接串（本地 docker-compose，主机映射端口 47432）：运行期 `DATABASE_URL`
 * 缺省时的权威回退默认值。原属 `@hatch-radar/config`，单进程 + web 纯前端后只剩库层消费，
 * 故下沉到 kernel（env 校验的归属地）。docker-compose / .env.example 的同串与此对齐。
 */
export const DEFAULT_DATABASE_URL = 'postgres://radar:radar@localhost:47432/hatch_radar';

/** HTTP 服务配置（env 推导）：api 用于监听端口。 */
export interface HttpConfig {
  /** 监听端口；绑定 0.0.0.0 供局域网内的移动端访问 */
  port: number;
}

/**
 * `KEY=`（空串 / 纯空白）一律按「未设置」处理：等同把该行注释掉。
 * 各 app 的 env schema 用它作 `z.preprocess` 前置，确保空串语义跨进程统一。
 */
export function stripEmptyEnv(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return out;
}

/**
 * 跨进程共享、且 api / worker 两端「必须一致」的基础 env 字段：
 *
 * - `DATABASE_URL` / `DATABASE_POOL_MAX`：两端连同一库（worker 按行锁 FOR UPDATE SKIP LOCKED 认领 job）；
 *   连接池上限的最终默认值由各 app 自行推导（api 与 worker 并发解耦）。
 * - `SETTINGS_SECRET`：模型密钥加密主密钥，两端不一致则无法互相解密（此处仅校验非空串，
 *   实际经 `process.env` 直读于 {@link ./utils/crypto}）。
 *
 * 各 app 在自己的包里 `z.object({ ...baseEnvShape, <自有字段> }).transform(...)`：
 * api 的 HTTP / 超管、worker 的网关 / 并发等专属项不进本基座，各自维护。
 */
export const baseEnvShape = {
  /** 模型密钥加密入库的主密钥（仅校验非空串；真正读取在 crypto） */
  SETTINGS_SECRET: z.string().trim().min(1).optional(),

  /** PostgreSQL 连接串，默认指向本地 docker-compose 的 PG */
  DATABASE_URL: z.string().trim().default(DEFAULT_DATABASE_URL),

  /** PG 连接池上限；不设时由各 app 推导默认值 */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).optional(),
};

/**
 * 用给定 schema 解析 `process.env`，校验失败一次性报告所有缺失 / 非法字段。
 * api / worker 各自的 `loadEnv` 都复用这条统一的报错管道（与裸跑早失败语义一致）。
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

/** PostgreSQL 连接串单独暴露：CLI / 迁移脚本不需要任何业务凭据 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}
