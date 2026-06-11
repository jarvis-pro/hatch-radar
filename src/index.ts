import { createAnthropicClient } from './analyzer/analyze.js';
import { HN_SECTIONS, RSS_FEEDS } from './config/feeds.js';
import { loadEnv } from './config/env.js';
import { SUBREDDITS } from './config/subreddits.js';
import { HackerNewsClient } from './crawler/hackernews.js';
import { TokenBucketQueue } from './crawler/queue.js';
import { RedditClient } from './crawler/reddit.js';
import * as q from './db/queries.js';
import { closeDb, getDb } from './db/schema.js';
import { log } from './log.js';
import { startScheduler } from './scheduler.js';

async function main(): Promise<void> {
  const env = loadEnv();
  getDb();

  const queue = new TokenBucketQueue();
  const reddit = env.reddit ? new RedditClient(queue, env.reddit) : undefined;
  const hackernews = new HackerNewsClient();
  const anthropic = createAnthropicClient(env.anthropicApiKey);

  const stats = q.getStats();
  log.info(`hatch-radar 启动`);

  const sources: string[] = [];
  if (reddit) sources.push(`Reddit (${SUBREDDITS.map((s) => `r/${s}`).join(', ')})`);
  sources.push(`HackerNews (${HN_SECTIONS.map((s) => s.channel).join(', ')})`);
  sources.push(`RSS (${RSS_FEEDS.map((f) => f.name).join(', ')})`);
  log.info(`监控来源: ${sources.join(' | ')}`);
  log.info(`分析模型: ${env.anthropicModel} | 每轮分析上限: ${env.analyzeBatchSize}`);
  log.info(
    `当前数据: 帖子 ${stats.posts} / 评论 ${stats.comments} / 待分析 ${stats.pendingAnalysis} / 洞察 ${stats.insights}`,
  );

  const jobs = startScheduler({
    reddit,
    hackernews,
    anthropic,
    model: env.anthropicModel,
    analyzeBatchSize: env.analyzeBatchSize,
    subreddits: reddit ? SUBREDDITS : [],
  });

  const shutdown = (signal: string) => {
    log.info(`收到 ${signal}，正在退出…`);
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log.info('启动初始化轮次：扫描 → 评论补全 → AI 分析');
  await jobs.scan();
  await jobs.comments();
  await jobs.analyze();
  log.info('初始化轮次完成，进入定时调度（查看洞察: pnpm insights）');
}

main().catch((err) => {
  log.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
