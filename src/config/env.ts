import 'dotenv/config';
import type { RedditConfig } from '../crawler/reddit.js';

/** 应用运行时所需的全量配置 */
export interface AppEnv {
  /** Reddit OAuth 凭据；未配置时为 undefined，调度器跳过 Reddit 抓取 */
  reddit?: RedditConfig;
  /** Anthropic API 密钥，来自环境变量 ANTHROPIC_API_KEY */
  anthropicApiKey: string;
  /** 使用的 Claude 模型 ID，默认 claude-opus-4-8 */
  anthropicModel: string;
  /** 每轮 AI 分析的帖子批次上限，默认 20 */
  analyzeBatchSize: number;
  /** SQLite 数据库文件路径 */
  databasePath: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请先 cp .env.example .env 并填写`);
  }
  return value;
}

/** 数据库路径单独暴露：cli / db:migrate 不需要 Reddit 与 Anthropic 凭据 */
export function databasePath(): string {
  return process.env.DATABASE_URL?.trim() || './data/radar.db';
}

/**
 * 从环境变量加载并校验应用配置。
 * - `REDDIT_CLIENT_ID` 与 `REDDIT_CLIENT_SECRET` 均存在时才初始化 Reddit 凭据，否则 `reddit` 为 undefined
 * - `ANTHROPIC_API_KEY` 缺失时抛出错误
 * @returns 校验通过的应用配置对象
 */
export function loadEnv(): AppEnv {
  const hasReddit = !!(
    process.env.REDDIT_CLIENT_ID?.trim() && process.env.REDDIT_CLIENT_SECRET?.trim()
  );
  return {
    reddit: hasReddit
      ? {
          clientId: required('REDDIT_CLIENT_ID'),
          clientSecret: required('REDDIT_CLIENT_SECRET'),
          username: required('REDDIT_USERNAME'),
          password: required('REDDIT_PASSWORD'),
          userAgent: required('REDDIT_USER_AGENT'),
        }
      : undefined,
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-4-8',
    analyzeBatchSize: Math.max(1, Number(process.env.ANALYZE_BATCH_SIZE) || 20),
    databasePath: databasePath(),
  };
}
