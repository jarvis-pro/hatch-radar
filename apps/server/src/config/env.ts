import { z } from 'zod';
import { DEFAULT_DATABASE_URL, DEFAULT_HTTP_PORT } from '@hatch-radar/config';
import type { AnalysisConfig } from '../analyzer/analyze';
import type { RedditConfig } from '../crawler/reddit';

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
    // 模型配置以「设置页入库」为权威来源；此处 env 仅作启动兜底：设了 AI_PROVIDER +
    // 对应 KEY，启动时会一次性迁移入库并设为 active。不设则不从 env 派生模型。

    /** 启动兜底用的分析方式（可选）；设置页配置后以库为准 */
    AI_PROVIDER: z.enum(['anthropic', 'openai', 'deepseek']).optional(),

    /** Anthropic API 密钥，可选；填写后可启用 Anthropic 分析 */
    ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
    /** 使用的 Anthropic 模型 ID，默认 claude-opus-4-8 */
    ANTHROPIC_MODEL: z.string().trim().default('claude-opus-4-8'),

    /** OpenAI API 密钥，可选；填写后可启用 OpenAI（ChatGPT）分析 */
    OPENAI_API_KEY: z.string().trim().min(1).optional(),
    /** 使用的 OpenAI 模型 ID，默认 gpt-4o（支持 json_schema strict 结构化输出） */
    OPENAI_MODEL: z.string().trim().default('gpt-4o'),
    /** OpenAI API 基地址，默认 https://api.openai.com/v1 */
    OPENAI_BASE_URL: z.string().trim().default('https://api.openai.com/v1'),

    /** DeepSeek API 密钥，可选；填写后可启用 DeepSeek 分析 */
    DEEPSEEK_API_KEY: z.string().trim().min(1).optional(),
    /** 使用的 DeepSeek 模型 ID，默认 deepseek-chat */
    DEEPSEEK_MODEL: z.string().trim().default('deepseek-chat'),
    /** DeepSeek API 基地址，默认 https://api.deepseek.com */
    DEEPSEEK_BASE_URL: z.string().trim().default('https://api.deepseek.com'),

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
    if (data.AI_PROVIDER === 'openai' && !data.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'AI_PROVIDER=openai 时必填',
        path: ['OPENAI_API_KEY'],
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
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX ?? Math.max(10, env.WORKER_CONCURRENCY + 5),
    http: { port: env.HTTP_PORT, token: env.API_TOKEN } satisfies HttpConfig,
    gatewayUrl: env.GATEWAY_URL,
    worker: {
      concurrency: env.WORKER_CONCURRENCY,
      jobTimeoutMs: env.WORKER_JOB_TIMEOUT_MS,
      staleSeconds: env.WORKER_STALE_SECONDS,
    } satisfies WorkerConfig,
  }));

/** resolveAnalysis 关心的字段子集（transform 的 env 结构化兼容此形状） */
interface AnalysisEnv {
  AI_PROVIDER?: 'anthropic' | 'openai' | 'deepseek';
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
  OPENAI_BASE_URL: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL: string;
  DEEPSEEK_BASE_URL: string;
}

/**
 * 根据 AI_PROVIDER 推导启动兜底的分析方式（缺对应 API Key 已在 superRefine 拦截）。
 * - 未设 AI_PROVIDER：返回 null（不从 env 派生模型，配置以设置页入库为准）
 * - anthropic / openai / deepseek：调用对应模型
 */
function resolveAnalysis(env: AnalysisEnv): AnalysisConfig | null {
  switch (env.AI_PROVIDER) {
    case 'anthropic':
      return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY!, model: env.ANTHROPIC_MODEL };
    case 'openai':
      return {
        provider: 'openai',
        apiKey: env.OPENAI_API_KEY!,
        baseUrl: env.OPENAI_BASE_URL,
        model: env.OPENAI_MODEL,
      };
    case 'deepseek':
      return {
        provider: 'deepseek',
        apiKey: env.DEEPSEEK_API_KEY!,
        baseUrl: env.DEEPSEEK_BASE_URL,
        model: env.DEEPSEEK_MODEL,
      };
    default:
      return null;
  }
}

/** 应用运行时所需的全量配置，由 envSchema 自动派生 */
export type AppEnv = z.infer<typeof envSchema>;

/**
 * 注：少数 env 变量刻意不经 AppEnv，因为须在 DI 容器就绪前或在纯模块中读取——这是有意为之，非遗漏：
 * - WORKER_IN_PROCESS：在 AppModule 模块定义期决定是否 import WorkerModule（早于 DI）
 * - SETTINGS_SECRET：仅 crypto.ts（纯模块、无 DI）按需读取，不下放到处处可见的 AppEnv
 * - LOG_DIR：logger.ts 在 bootstrap 之前就要初始化
 * - {@link databaseUrl}：CLI / 迁移脚本的轻量路径，不构建完整 AppEnv
 *
 * 这些在 DI / ConfigModule 之前读取的变量，靠启动脚本的 `node --env-file-if-exists=.env`
 * 把 .env 注入 process.env（早于任何模块求值），故写在 .env 文件里同样生效——不必额外 export。
 */

/** PostgreSQL 连接串单独暴露：CLI / 迁移脚本不需要 Reddit 与模型凭据 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

/**
 * 从环境变量加载并校验应用配置。
 * - `REDDIT_CLIENT_ID` 与 `REDDIT_CLIENT_SECRET` 均存在时启用 Reddit，否则 `reddit` 为 undefined
 * - 分析方式由 `AI_PROVIDER` 决定（不设则不从 env 派生模型）
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
