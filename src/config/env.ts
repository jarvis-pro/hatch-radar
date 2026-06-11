import 'dotenv/config';
import type { RedditConfig } from '../crawler/reddit.js';

export interface AppEnv {
  reddit?: RedditConfig;
  anthropicApiKey: string;
  anthropicModel: string;
  analyzeBatchSize: number;
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
