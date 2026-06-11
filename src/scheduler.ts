import type Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';
import { runAnalysisBatch } from './analyzer/analyze.js';
import type { RedditClient } from './crawler/reddit.js';
import * as q from './db/queries.js';
import { log } from './log.js';

const ARCHIVE_DAYS = 30;
const COMMENT_BATCH_LIMIT = 200;

export interface SchedulerDeps {
  reddit: RedditClient;
  anthropic: Anthropic;
  model: string;
  analyzeBatchSize: number;
  subreddits: string[];
}

export interface Jobs {
  scan: () => Promise<void>;
  comments: () => Promise<void>;
  analyze: () => Promise<void>;
  archive: () => Promise<void>;
}

/** 包装任务：同名任务不并发（上一轮未结束则跳过），异常只记录不抛出 */
function guard(name: string, fn: () => Promise<void>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      log.warn(`[${name}] 上一轮仍在执行，跳过本轮`);
      return;
    }
    running = true;
    const started = Date.now();
    try {
      await fn();
      log.info(`[${name}] 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      log.error(`[${name}] 出错: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
}

export function createJobs(deps: SchedulerDeps): Jobs {
  const scan = guard('扫描', async () => {
    for (const subreddit of deps.subreddits) {
      for (const sort of ['hot', 'new'] as const) {
        const posts = await deps.reddit.fetchListing(subreddit, sort, 25);
        const { added, updated } = q.upsertPosts(posts, q.nowSec());
        log.info(
          `[扫描] r/${subreddit}/${sort}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`,
        );
      }
    }
  });

  const comments = guard('评论补全', async () => {
    const due = q.getPostsDueForComments(q.nowSec(), COMMENT_BATCH_LIMIT);
    if (due.length === 0) {
      log.info(`[评论补全] 没有到达 6h/12h 回捞窗口的帖子`);
      return;
    }
    log.info(`[评论补全] ${due.length} 篇帖子待回捞评论`);
    for (const { post, pass } of due) {
      const fetched = await deps.reddit.fetchComments(post.subreddit, post.id);
      q.replaceComments(post.id, fetched, pass, q.nowSec());
    }
  });

  const analyze = guard('AI 分析', async () => {
    const stats = await runAnalysisBatch(deps.anthropic, deps.model, deps.analyzeBatchSize);
    log.info(
      `[AI 分析] 分析 ${stats.analyzed} 篇，产出洞察 ${stats.saved} 条，失败 ${stats.failed} 篇`,
    );
  });

  const archive = guard('归档', async () => {
    const cutoff = q.nowSec() - ARCHIVE_DAYS * 86400;
    const removed = q.archiveOldData(cutoff);
    log.info(
      `[归档] 清理 ${ARCHIVE_DAYS} 天前原始数据：帖子 ${removed.posts}，评论 ${removed.comments}（洞察保留）`,
    );
  });

  return { scan, comments, analyze, archive };
}

/**
 * 调度策略（见 README）：
 * - 热门帖子扫描：每 30 分钟
 * - 评论补全：每 30 分钟检查一次，对发帖满 6h / 12h 的帖子回捞评论
 * - AI 批量分析：每小时
 * - 历史归档：每天凌晨
 */
export function startScheduler(deps: SchedulerDeps): Jobs {
  const jobs = createJobs(deps);
  cron.schedule('0,30 * * * *', jobs.scan);
  cron.schedule('10,40 * * * *', jobs.comments);
  cron.schedule('20 * * * *', jobs.analyze);
  cron.schedule('30 3 * * *', jobs.archive);
  return jobs;
}
