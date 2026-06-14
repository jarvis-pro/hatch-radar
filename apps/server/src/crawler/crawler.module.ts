import { Module } from '@nestjs/common';
import { APP_ENV } from '@/common/tokens';
import type { AppEnv } from '@/config/env';
import { HackerNewsClient } from './hackernews';
import { TokenBucketQueue } from './queue';
import { RedditClient } from './reddit';

/** 注入令牌：Reddit 客户端（未配置 Reddit 凭据时为 null） */
export const REDDIT_CLIENT = Symbol('REDDIT_CLIENT');

/**
 * 抓取模块：把令牌桶队列与各来源客户端封装为可注入 provider。
 * Reddit 客户端按 env.reddit 是否配置决定为实例或 null（RSS 用纯函数 fetchFeed，不入 DI）。
 */
@Module({
  providers: [
    { provide: TokenBucketQueue, useFactory: () => new TokenBucketQueue() },
    { provide: HackerNewsClient, useFactory: () => new HackerNewsClient() },
    {
      provide: REDDIT_CLIENT,
      inject: [APP_ENV, TokenBucketQueue],
      useFactory: (env: AppEnv, queue: TokenBucketQueue): RedditClient | null =>
        env.reddit ? new RedditClient(queue, env.reddit) : null,
    },
  ],
  exports: [TokenBucketQueue, HackerNewsClient, REDDIT_CLIENT],
})
export class CrawlerModule {}
