import 'dotenv/config';
import { z } from 'zod';
import type { AnalysisConfig } from '../analyzer/analyze';
import type { RedditConfig } from '../crawler/reddit';
import type { HttpConfig } from '../server/http';

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

    // ── AI 分析方式 ───────────────────────────────────────────────────
    // 默认 file（导出本地文件，无需任何 key）。要用模型须显式设
    // AI_PROVIDER=anthropic / deepseek 并填写对应 API Key（缺 key 校验阶段报错）。

    /** 分析方式，默认 file（导出本地文件）；用模型须显式设为 anthropic / deepseek */
    AI_PROVIDER: z.enum(['anthropic', 'deepseek', 'file']).default('file'),

    /** Anthropic API 密钥，可选；填写后可启用 Anthropic 分析 */
    ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
    /** 使用的 Anthropic 模型 ID，默认 claude-opus-4-8 */
    ANTHROPIC_MODEL: z.string().trim().default('claude-opus-4-8'),

    /** DeepSeek API 密钥，可选；填写后可启用 DeepSeek 分析 */
    DEEPSEEK_API_KEY: z.string().trim().min(1).optional(),
    /** 使用的 DeepSeek 模型 ID，默认 deepseek-chat */
    DEEPSEEK_MODEL: z.string().trim().default('deepseek-chat'),
    /** DeepSeek API 基地址，默认 https://api.deepseek.com */
    DEEPSEEK_BASE_URL: z.string().trim().default('https://api.deepseek.com'),

    /** file 模式下待分析内容的导出目录，默认 ./data/manual-analysis */
    MANUAL_ANALYSIS_DIR: z.string().trim().default('./data/manual-analysis'),

    /** 每轮 AI 分析的帖子批次上限，默认 20，最小 1 */
    ANALYZE_BATCH_SIZE: z.coerce.number().int().min(1).default(20),

    // ── 存储 ─────────────────────────────────────────────────────────

    /** SQLite 数据库文件路径，默认 ./data/radar.db */
    DATABASE_URL: z.string().trim().default('./data/radar.db'),

    // ── 导出服务（局域网 HTTP，供移动端拉取批次）──────────────────────

    /** 导出 HTTP 服务监听端口，默认 8787；绑定 0.0.0.0 */
    HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    /** 可选访问令牌；设置后导出接口要求 Authorization: Bearer <token> */
    EXPORT_TOKEN: z.string().trim().min(1).optional(),
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
    // 显式指定的分析方式必须有对应的 API Key
    if (data.AI_PROVIDER === 'anthropic' && !data.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'AI_PROVIDER=anthropic 时必填',
        path: ['ANTHROPIC_API_KEY'],
      });
    }
    if (data.AI_PROVIDER === 'deepseek' && !data.DEEPSEEK_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'AI_PROVIDER=deepseek 时必填',
        path: ['DEEPSEEK_API_KEY'],
      });
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
    analysis: resolveAnalysis(env),
    analyzeBatchSize: env.ANALYZE_BATCH_SIZE,
    databasePath: env.DATABASE_URL,
    http: { port: env.HTTP_PORT, token: env.EXPORT_TOKEN } satisfies HttpConfig,
  }));

/** resolveAnalysis 关心的字段子集（transform 的 env 结构化兼容此形状） */
interface AnalysisEnv {
  AI_PROVIDER: 'anthropic' | 'deepseek' | 'file';
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL: string;
  DEEPSEEK_BASE_URL: string;
  MANUAL_ANALYSIS_DIR: string;
}

/**
 * 根据 AI_PROVIDER 推导最终的分析方式（缺对应 API Key 已在 superRefine 拦截）。
 * - anthropic / deepseek：调用对应模型
 * - file（默认）：导出本地文件，供手动喂给 AI
 */
function resolveAnalysis(env: AnalysisEnv): AnalysisConfig {
  switch (env.AI_PROVIDER) {
    case 'anthropic':
      return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY!, model: env.ANTHROPIC_MODEL };
    case 'deepseek':
      return {
        provider: 'deepseek',
        apiKey: env.DEEPSEEK_API_KEY!,
        baseUrl: env.DEEPSEEK_BASE_URL,
        model: env.DEEPSEEK_MODEL,
      };
    case 'file':
      return { provider: 'file', dir: env.MANUAL_ANALYSIS_DIR };
  }
}

/** 应用运行时所需的全量配置，由 envSchema 自动派生 */
export type AppEnv = z.infer<typeof envSchema>;

/** 数据库路径单独暴露：cli / db:migrate 不需要 Reddit 与模型凭据 */
export function databasePath(): string {
  return process.env.DATABASE_URL?.trim() || './data/radar.db';
}

/**
 * 从环境变量加载并校验应用配置。
 * - `REDDIT_CLIENT_ID` 与 `REDDIT_CLIENT_SECRET` 均存在时启用 Reddit，否则 `reddit` 为 undefined
 * - 分析方式由 `AI_PROVIDER` 决定（默认 file），详见 {@link resolveAnalysis}
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
