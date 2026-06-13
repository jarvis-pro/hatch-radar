import cron from 'node-cron';
import { runAnalysisBatch } from './analyzer/analyze';
import type { PostProcessor } from './analyzer/analyze';
import { HN_SECTIONS, RSS_FEEDS } from './config/feeds';
import type { HackerNewsClient } from './crawler/hackernews';
import type { RedditComment } from './crawler/reddit';
import type { RedditClient } from './crawler/reddit';
import { fetchFeed } from './crawler/rss';
import { replaceComments } from './db/comments';
import { archiveOldData, getPostsNeedingCommentRefresh, upsertPosts } from './db/posts';
import { nowSec } from './db/utils';
import { logger } from './logger';

const ARCHIVE_DAYS = 30;
const COMMENT_BATCH_LIMIT = 200;
/** 评论抓取后写入的 comment_pass 值（≥1 表示已抓，可进入分析队列） */
const COMMENT_FETCHED_PASS = 2;

/** startScheduler() 与 createJobs() 所需的外部依赖 */
export interface SchedulerDeps {
  /** Reddit 客户端；未提供时跳过 Reddit 抓取与评论回捞 */
  reddit?: RedditClient;
  /** HackerNews 客户端；未提供时跳过 HN 抓取与评论回捞 */
  hackernews?: HackerNewsClient;
  /** 单篇帖子处理器：Anthropic / DeepSeek 分析或本地文件导出 */
  processor: PostProcessor;
  /** 每轮 AI 分析的帖子批次上限 */
  analyzeBatchSize: number;
  /** 要监控的 Reddit 版块名称列表；reddit 为 undefined 时忽略 */
  subreddits: string[];
  /** 是否自动跑 AI 分析；file 模式为 false（洞察改由 web 工作台按需导出 + 人工回灌） */
  autoAnalyze: boolean;
}

/** createJobs() 返回的四个调度任务句柄 */
export interface Jobs {
  /** 从所有已启用来源抓取最新帖子并写入数据库 */
  scan: () => Promise<void>;
  /** 抓取/刷新需要评论的帖子（从未抓过优先 + 有界 refresh；RSS 与冻结帖除外） */
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
/** 评论抓取目标：source 决定用哪个客户端，subreddit 供 Reddit 评论接口 */
interface CommentTarget {
  id: string;
  source: string;
  subreddit: string;
}

export function createJobs(deps: SchedulerDeps): Jobs {
  /** 抓取单篇帖子评论并落库（Reddit 经令牌桶限速，HN 内部批量；内容 diff 由 replaceComments 处理） */
  async function fetchAndStoreComments(target: CommentTarget): Promise<void> {
    let fetched: RedditComment[];
    if (target.source === 'hackernews' && deps.hackernews) {
      fetched = await deps.hackernews.fetchComments(target.id);
    } else if (target.source === 'reddit' && deps.reddit) {
      fetched = await deps.reddit.fetchComments(target.subreddit, target.id);
    } else {
      return;
    }
    replaceComments(target.id, fetched, COMMENT_FETCHED_PASS, nowSec());
  }

  /**
   * 后台串行抓取新帖评论（fire-and-forget）：逐篇 await——
   * HN 不会并发爆发、Reddit 由令牌桶限速；进程中断时遗漏的由 comments refresh 兜底。
   */
  async function drainNewComments(targets: CommentTarget[]): Promise<void> {
    for (const t of targets) {
      try {
        await fetchAndStoreComments(t);
      } catch (err) {
        logger.warn(
          `[即时评论] ${t.id} 抓取失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const scan = guard('扫描', async () => {
    const fresh: CommentTarget[] = [];

    // Reddit
    if (deps.reddit && deps.subreddits.length > 0) {
      for (const subreddit of deps.subreddits) {
        for (const sort of ['hot', 'new'] as const) {
          const posts = await deps.reddit.fetchListing(subreddit, sort, 25);
          const { added, updated, newPosts } = upsertPosts(posts, 'reddit', nowSec());
          for (const p of newPosts) {
            fresh.push({ id: p.id, source: 'reddit', subreddit: p.subreddit });
          }
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
        const { added, updated, newPosts } = upsertPosts(posts, 'hackernews', nowSec());
        for (const p of newPosts) {
          fresh.push({ id: p.id, source: 'hackernews', subreddit: p.subreddit });
        }
        logger.info(
          `[扫描] HN/${section.channel}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`,
        );
      }
    }

    // RSS（无评论，直接设 comment_pass=2 进入分析队列；不触发评论抓取）
    for (const feed of RSS_FEEDS) {
      try {
        const posts = await fetchFeed(feed, 20);
        const { added, updated } = upsertPosts(posts, 'rss', nowSec(), 2);
        logger.info(`[扫描] RSS/${feed.name}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`);
      } catch (err) {
        logger.warn(
          `[扫描] RSS/${feed.name} 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 新帖即时抓评论：后台串行 drain，不阻塞本次扫描；遗漏的由 refresh 兜底
    if (fresh.length > 0) {
      logger.info(`[扫描] 触发 ${fresh.length} 篇新帖即时评论抓取（后台）`);
      void drainNewComments(fresh);
    }
  });

  const comments = guard('评论补全', async () => {
    const due = getPostsNeedingCommentRefresh(nowSec(), COMMENT_BATCH_LIMIT);
    if (due.length === 0) {
      logger.info(`[评论补全] 暂无待抓/待刷新的帖子`);
      return;
    }
    logger.info(`[评论补全] ${due.length} 篇待抓/刷新评论`);
    for (const post of due) {
      try {
        await fetchAndStoreComments({ id: post.id, source: post.source, subreddit: post.subreddit });
      } catch (err) {
        logger.error(
          `[评论补全] ${post.id} 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  });

  const analyze = guard('AI 分析', async () => {
    const stats = await runAnalysisBatch(deps.processor, deps.analyzeBatchSize);
    logger.info(
      `[AI 分析] 处理 ${stats.analyzed} 篇，产出洞察 ${stats.saved} 条，失败 ${stats.failed} 篇`,
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
 * - 扫描（Reddit hot/new + HN + RSS）：每 30 分钟；新帖触发后台即时评论抓取
 * - 评论补全（Reddit + HN，RSS 跳过）：每 30 分钟，抓未抓过的 + 有界 refresh
 * - AI 批量分析：每小时（仅 autoAnalyze=true，即 anthropic/deepseek；file 模式不自动跑）
 * - 历史归档：每天凌晨 3:30
 * @param deps 运行时依赖
 * @returns 注册成功的任务句柄（可在启动时手动执行初始轮次）
 */
export function startScheduler(deps: SchedulerDeps): Jobs {
  const jobs = createJobs(deps);
  cron.schedule('0,30 * * * *', jobs.scan);
  cron.schedule('10,40 * * * *', jobs.comments);
  // file 模式不自动分析：洞察改由 web 工作台按需导出 + 人工回灌；仅 anthropic/deepseek 自动跑
  if (deps.autoAnalyze) cron.schedule('20 * * * *', jobs.analyze);
  cron.schedule('30 3 * * *', jobs.archive);
  return jobs;
}
