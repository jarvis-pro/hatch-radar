import 'dotenv/config';
import { z } from 'zod';
import type { RedditConfig } from '../crawler/reddit';

const envSchema = z
  .object({
    // ── Reddit OAuth（五个字段全填或全不填）──────────────────────────

    /** Reddit 应用 Client ID，在 reddit.com/prefs/apps 创建 */
    REDDIT_CLIENT_ID: z.string().trim().min(1).optional(),
    /** Reddit 应用 Client Secret */
    REDDIT_CLIENT_SECRET: z.string().trim().min(1).optional(),
    /** 用于 OAuth 授权的 Reddit 账号用户名 */
    REDDIT_USERNAME: z.string().trim().min(1).optional(),
    /** 对应账号的密码 */
    REDDIT_PASSWORD: z.string().trim().min(1).optional(),
    /** HTTP User-Agent，格式建议 `<platform>:<appid>:<version> (by u/<user>)` */
    REDDIT_USER_AGENT: z.string().trim().min(1).optional(),

    // ── Anthropic ────────────────────────────────────────────────────

    /** Anthropic API 密钥，必填 */
    ANTHROPIC_API_KEY: z.string().trim().min(1),
    /** 使用的 Claude 模型 ID，默认 claude-opus-4-8 */
    ANTHROPIC_MODEL: z.string().trim().default('claude-opus-4-8'),
    /** 每轮 AI 分析的帖子批次上限，默认 20，最小 1 */
    ANALYZE_BATCH_SIZE: z.coerce.number().int().min(1).default(20),

    // ── 存储 ─────────────────────────────────────────────────────────

    /** SQLite 数据库文件路径，默认 ./data/radar.db */
    DATABASE_URL: z.string().trim().default('./data/radar.db'),
  })
  .superRefine((data, ctx) => {
    // CLIENT_ID + CLIENT_SECRET 存在即视为启用 Reddit，其余 3 个字段变为必填
    if (data.REDDIT_CLIENT_ID && data.REDDIT_CLIENT_SECRET) {
      for (const key of ['REDDIT_USERNAME', 'REDDIT_PASSWORD', 'REDDIT_USER_AGENT'] as const) {
        if (!data[key]) {
          ctx.addIssue({
            code: 'custom',
            message: 'Reddit 凭据不完整，该字段必填',
            path: [key],
          });
        }
      }
    }
  })
  .transform((env) => ({
    reddit:
      env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET
        ? ({
            clientId: env.REDDIT_CLIENT_ID,
            clientSecret: env.REDDIT_CLIENT_SECRET,
            username: env.REDDIT_USERNAME!,
            password: env.REDDIT_PASSWORD!,
            userAgent: env.REDDIT_USER_AGENT!,
          } satisfies RedditConfig)
        : undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    analyzeBatchSize: env.ANALYZE_BATCH_SIZE,
    databasePath: env.DATABASE_URL,
  }));

/** 应用运行时所需的全量配置，由 envSchema 自动派生 */
export type AppEnv = z.infer<typeof envSchema>;

/** 数据库路径单独暴露：cli / db:migrate 不需要 Reddit 与 Anthropic 凭据 */
export function databasePath(): string {
  return process.env.DATABASE_URL?.trim() || './data/radar.db';
}

/**
 * 从环境变量加载并校验应用配置。
 * - `REDDIT_CLIENT_ID` 与 `REDDIT_CLIENT_SECRET` 均存在时启用 Reddit，否则 `reddit` 为 undefined
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
