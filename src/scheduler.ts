import type Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';
import { runAnalysisBatch } from './analyzer/analyze';
import { HN_SECTIONS, RSS_FEEDS } from './config/feeds';
import type { HackerNewsClient } from './crawler/hackernews';
import type { RedditComment } from './crawler/reddit';
import type { RedditClient } from './crawler/reddit';
import { fetchFeed } from './crawler/rss';
import { replaceComments } from './db/comments';
import { archiveOldData, getPostsDueForComments, upsertPosts } from './db/posts';
import { nowSec } from './db/utils';
import { logger } from './logger';

const ARCHIVE_DAYS = 30;
const COMMENT_BATCH_LIMIT = 200;

/** startScheduler() 与 createJobs() 所需的外部依赖 */
export interface SchedulerDeps {
  /** Reddit 客户端；未提供时跳过 Reddit 抓取与评论回捞 */
  reddit?: RedditClient;
  /** HackerNews 客户端；未提供时跳过 HN 抓取与评论回捞 */
  hackernews?: HackerNewsClient;
  anthropic: Anthropic;
  /** 使用的 Claude 模型 ID */
  model: string;
  /** 每轮 AI 分析的帖子批次上限 */
  analyzeBatchSize: number;
  /** 要监控的 Reddit 版块名称列表；reddit 为 undefined 时忽略 */
  subreddits: string[];
}

/** createJobs() 返回的四个调度任务句柄 */
export interface Jobs {
  /** 从所有已启用来源抓取最新帖子并写入数据库 */
  scan: () => Promise<void>;
  /** 对到达 6h/12h 窗口的帖子回捞评论（RSS 帖子不在此列） */
  comments: () => Promise<void>;
  /** 批量 AI 分析待处理帖子并落库洞察 */
  analyze: () => Promise<void>;
  /** 清理 30 天前的原始帖子与评论数据 */
  archive: () => Promise<void>;
}

/** 包装任务：同名任务不并发（上一轮未结束则跳过），异常只记录不抛出 */
function guard(name: string, fn: () => Promise<void>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      logger.warn(`[${name}] 上一轮仍在执行，跳过本轮`);
      return;
    }
    running = true;
    const started = Date.now();
    try {
      await fn();
      logger.info(`[${name}] 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      logger.error(`[${name}] 出错: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
}

/**
 * 创建四个调度任务函数，每个任务通过 guard 保证同名任务不并发执行。
 * @param deps 运行时依赖；reddit / hackernews 为 undefined 时对应来源的操作被跳过
 * @returns 可直接调用或传给 cron 调度的任务对象
 */
export function createJobs(deps: SchedulerDeps): Jobs {
  const scan = guard('扫描', async () => {
    // Reddit
    if (deps.reddit && deps.subreddits.length > 0) {
      for (const subreddit of deps.subreddits) {
        for (const sort of ['hot', 'new'] as const) {
          const posts = await deps.reddit.fetchListing(subreddit, sort, 25);
          const { added, updated } = upsertPosts(posts, 'reddit', nowSec());
          logger.info(
            `[扫描] r/${subreddit}/${sort}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`,
          );
        }
      }
    }

    // HackerNews
    if (deps.hackernews) {
      for (const section of HN_SECTIONS) {
        const posts = await deps.hackernews.fetchStories(section.endpoint, section.channel, 30);
        const { added, updated } = upsertPosts(posts, 'hackernews', nowSec());
        logger.info(
          `[扫描] HN/${section.channel}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`,
        );
      }
    }

    // RSS（无评论，直接设 comment_pass=2 进入分析队列）
    for (const feed of RSS_FEEDS) {
      try {
        const posts = await fetchFeed(feed, 20);
        const { added, updated } = upsertPosts(posts, 'rss', nowSec(), 2);
        logger.info(
          `[扫描] RSS/${feed.name}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`,
        );
      } catch (err) {
        logger.warn(
          `[扫描] RSS/${feed.name} 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  });

  const comments = guard('评论补全', async () => {
    const due = getPostsDueForComments(nowSec(), COMMENT_BATCH_LIMIT);
    if (due.length === 0) {
      logger.info(`[评论补全] 没有到达 6h/12h 回捞窗口的帖子`);
      return;
    }
    logger.info(`[评论补全] ${due.length} 篇帖子待回捞评论`);
    for (const { post, pass } of due) {
      let fetched: RedditComment[] = [];
      if (post.source === 'hackernews' && deps.hackernews) {
        fetched = await deps.hackernews.fetchComments(post.id);
      } else if (post.source === 'reddit' && deps.reddit) {
        fetched = await deps.reddit.fetchComments(post.subreddit, post.id);
      }
      replaceComments(post.id, fetched, pass, nowSec());
    }
  });

  const analyze = guard('AI 分析', async () => {
    const stats = await runAnalysisBatch(deps.anthropic, deps.model, deps.analyzeBatchSize);
    logger.info(
      `[AI 分析] 分析 ${stats.analyzed} 篇，产出洞察 ${stats.saved} 条，失败 ${stats.failed} 篇`,
    );
  });

  const archive = guard('归档', async () => {
    const cutoff = nowSec() - ARCHIVE_DAYS * 86400;
    const removed = archiveOldData(cutoff);
    logger.info(
      `[归档] 清理 ${ARCHIVE_DAYS} 天前原始数据：帖子 ${removed.posts}，评论 ${removed.comments}（洞察保留）`,
    );
  });

  return { scan, comments, analyze, archive };
}

/**
 * 创建调度任务并注册 cron 计划，立即返回任务句柄供启动时调用。
 * - 扫描（Reddit hot/new + HN + RSS）：每 30 分钟
 * - 评论补全（Reddit + HN，RSS 跳过）：每 30 分钟检查，发帖满 6h/12h 回捞
 * - AI 批量分析：每小时
 * - 历史归档：每天凌晨 3:30
 * @param deps 运行时依赖
 * @returns 注册成功的任务句柄（可在启动时手动执行初始轮次）
 */
export function startScheduler(deps: SchedulerDeps): Jobs {
  const jobs = createJobs(deps);
  cron.schedule('0,30 * * * *', jobs.scan);
  cron.schedule('10,40 * * * *', jobs.comments);
  cron.schedule('20 * * * *', jobs.analyze);
  cron.schedule('30 3 * * *', jobs.archive);
  return jobs;
}
