import {
  getActiveProvider,
  getProcessorForProvider,
  seedProvidersFromEnvIfEmpty,
} from './analysis-config';
import { HN_SECTIONS, RSS_FEEDS } from './config/feeds';
import { loadEnv } from './config/env';
import { SUBREDDITS } from './config/subreddits';
import { HackerNewsClient } from './crawler/hackernews';
import { TokenBucketQueue } from './crawler/queue';
import { RedditClient } from './crawler/reddit';
import { getStats } from './db/utils';
import { closeDb, getDb } from './db/schema';
import { logger } from './logger';
import { startScheduler } from './scheduler';
import { startHttpServer } from './server/http';
import { startWorkerPool, type WorkerPool } from './worker';

async function main(): Promise<void> {
  const env = loadEnv();
  getDb();

  const queue = new TokenBucketQueue();
  const reddit = env.reddit ? new RedditClient(queue, env.reddit) : undefined;
  const hackernews = new HackerNewsClient();

  // 一次性迁移：库中尚无模型配置但 env 指定了模型时，把 env 密钥加密入库并设为 active
  seedProvidersFromEnvIfEmpty(env.analysis);

  const stats = getStats();
  logger.info(`hatch-radar 启动`);

  const sources: string[] = [];
  if (reddit) sources.push(`Reddit (${SUBREDDITS.map((s) => `r/${s}`).join(', ')})`);
  sources.push(`HackerNews (${HN_SECTIONS.map((s) => s.channel).join(', ')})`);
  sources.push(`RSS (${RSS_FEEDS.map((f) => f.name).join(', ')})`);
  logger.info(`监控来源 (${sources.length}):`);
  for (const src of sources) {
    logger.info(`  · ${src}`);
  }
  const active = getActiveProvider();
  logger.info(
    `分析模型: ${active ? active.label : '未配置（在设置页选用后即自动分析）'} | 每轮分析上限: ${env.analyzeBatchSize}`,
  );
  logger.info(
    `当前数据: 帖子 ${stats.posts} / 评论 ${stats.comments} / 待分析 ${stats.pendingAnalysis} / 洞察 ${stats.insights}`,
  );

  const jobs = startScheduler({
    reddit,
    hackernews,
    analyzeBatchSize: env.analyzeBatchSize,
    subreddits: reddit ? SUBREDDITS : [],
  });

  // worker 池常驻：按 job.provider_id 从库解析处理器，消费自动/手动入队的分析任务。
  // 队列空时空转；在设置页配置并选用模型后，新任务即被消费（保存即生效，无需重启）。
  const worker: WorkerPool = startWorkerPool({
    resolveProcessor: (job) =>
      job.provider_id != null ? getProcessorForProvider(job.provider_id) : null,
  });

  // 局域网导出服务：供移动端拉取批次（只下行数据，密钥不经过此服务）
  const httpServer = startHttpServer(env.http);

  const shutdown = async (signal: string) => {
    logger.info(`收到 ${signal}，正在退出…`);
    await worker.stop();
    httpServer.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('启动初始化轮次：扫描 → 评论补全 → AI 分析入队');
  await jobs.scan();
  await jobs.comments();
  await jobs.analyze();
  logger.info('初始化轮次完成，进入定时调度（查看洞察: pnpm insights）');
}

main().catch((err) => {
  logger.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
