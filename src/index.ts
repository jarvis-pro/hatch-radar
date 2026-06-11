import { createAnthropicClient } from './analyzer/analyze.js';
import { loadEnv } from './config/env.js';
import { SUBREDDITS } from './config/subreddits.js';
import { TokenBucketQueue } from './crawler/queue.js';
import { RedditClient } from './crawler/reddit.js';
import * as q from './db/queries.js';
import { closeDb, getDb } from './db/schema.js';
import { log } from './log.js';
import { startScheduler } from './scheduler.js';

async function main(): Promise<void> {
  const env = loadEnv();
  getDb(); // 初始化数据库（自动建表）

  const queue = new TokenBucketQueue();
  const reddit = new RedditClient(queue, env.reddit);
  const anthropic = createAnthropicClient(env.anthropicApiKey);

  const stats = q.getStats();
  log.info(`hatch-radar 启动`);
  log.info(`监控版块: ${SUBREDDITS.map((s) => `r/${s}`).join(', ')}`);
  log.info(`分析模型: ${env.anthropicModel} | 每轮分析上限: ${env.analyzeBatchSize}`);
  log.info(
    `当前数据: 帖子 ${stats.posts} / 评论 ${stats.comments} / 待分析 ${stats.pendingAnalysis} / 洞察 ${stats.insights}`,
  );

  const jobs = startScheduler({
    reddit,
    anthropic,
    model: env.anthropicModel,
    analyzeBatchSize: env.analyzeBatchSize,
    subreddits: SUBREDDITS,
  });

  const shutdown = (signal: string) => {
    log.info(`收到 ${signal}，正在退出…`);
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 启动后立即跑一轮 扫描 → 评论 → 分析，无需等待下一个整点
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
