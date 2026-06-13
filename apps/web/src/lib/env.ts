import 'server-only';
import { z } from 'zod';
import { DEFAULT_DATABASE_URL, DEFAULT_SERVER_API_URL } from '@hatch-radar/config';

/**
 * web 端环境变量（只读切片）。
 *
 * web 只读 PG + 把写操作/配置读取转发给 server，故只需这三项；默认值取自共享的
 * `@hatch-radar/config`（与 server 同源），校验风格与 server 的 zod 一致。
 * 含密钥的配置（AI keys / SETTINGS_SECRET 等）只在 server 进程，web 永不读。
 */
const schema = z.object({
  /** PostgreSQL 只读连接串（与 server 同一个库） */
  DATABASE_URL: z.string().trim().default(DEFAULT_DATABASE_URL),
  /** 工作台 server 进程地址（写操作 / 配置读取经此转发） */
  SERVER_API_URL: z.string().trim().default(DEFAULT_SERVER_API_URL),
  /** 可选访问令牌；server 设了 API_TOKEN 时 web 也须配同值 */
  API_TOKEN: z.string().trim().optional(),
});

/** 校验后的 web 配置切片 */
export interface WebEnv {
  databaseUrl: string;
  serverApiUrl: string;
  apiToken?: string;
}

let cached: WebEnv | undefined;

/**
 * 解析并缓存 web 环境变量（首次调用校验；非法即抛，快速失败）。
 * 用函数而非模块顶层常量：避免在构建期/导入期就读 process.env。
 */
export function webEnv(): WebEnv {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`web 环境变量校验失败：\n${messages}`);
  }
  cached = {
    databaseUrl: result.data.DATABASE_URL,
    serverApiUrl: result.data.SERVER_API_URL,
    apiToken: result.data.API_TOKEN,
  };
  return cached;
}
