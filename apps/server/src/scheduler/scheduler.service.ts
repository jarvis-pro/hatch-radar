import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AnalysisConfigService } from '../analysis/analysis-config.service';
import { APP_ENV } from '../common/tokens';
import { nowSec } from '../common/time';
import type { AppEnv } from '../config/env';
import { HN_SECTIONS, RSS_FEEDS } from '../config/feeds';
import { SUBREDDITS } from '../config/subreddits';
import { REDDIT_CLIENT } from '../crawler/crawler.module';
import { HackerNewsClient } from '../crawler/hackernews';
import type { RedditClient, RedditComment } from '../crawler/reddit';
import { fetchFeed } from '../crawler/rss';
import { CommentsRepository } from '../db/comments.repository';
import { PostsRepository } from '../db/posts.repository';
import { logger } from '../logger';

const ARCHIVE_DAYS = 30;
const COMMENT_BATCH_LIMIT = 200;
/** 评论抓取后写入的 comment_pass 值（≥1 表示已抓，可进入分析队列） */
const COMMENT_FETCHED_PASS = 2;

/** 评论抓取目标：source 决定用哪个客户端，subreddit 供 Reddit 评论接口 */
interface CommentTarget {
  id: string;
  source: string;
  subreddit: string;
}

/**
 * 定时调度服务：扫描 / 评论补全 / AI 分析入队 / 归档。
 *
 * - cron 用 `@nestjs/schedule` 的 `@Cron`
 * - 同名任务不并发由 {@link guard} 保证（框架不内置，沿用裸跑的非重入语义）
 * - 启动后跑一轮初始化（扫描 → 评论补全 → 分析入队），不阻塞 HTTP 监听
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  /** 正在执行的任务名集合（同名不并发） */
  private readonly running = new Set<string>();

  constructor(
    @Inject(REDDIT_CLIENT) private readonly reddit: RedditClient | null,
    private readonly hackernews: HackerNewsClient,
    private readonly postsRepo: PostsRepository,
    private readonly commentsRepo: CommentsRepository,
    private readonly analysisConfig: AnalysisConfigService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private get subreddits(): string[] {
    return this.reddit ? SUBREDDITS : [];
  }

  onApplicationBootstrap(): void {
    // 初始化轮次：不阻塞应用启动 / HTTP 监听
    void this.runInitialRound();
  }

  /** 启动后的一次性初始化轮次：扫描 → 评论补全 → 分析入队 */
  private async runInitialRound(): Promise<void> {
    logger.info('启动初始化轮次：扫描 → 评论补全 → AI 分析入队');
    await this.scan();
    await this.comments();
    await this.analyze();
    logger.info('初始化轮次完成，进入定时调度（查看洞察: pnpm cli insights）');
  }

  /** 包装任务：同名任务不并发（上一轮未结束则跳过），异常只记录不抛出 */
  private async guard(name: string, fn: () => Promise<void>): Promise<void> {
    if (this.running.has(name)) {
      logger.warn(`[${name}] 上一轮仍在执行，跳过本轮`);
      return;
    }
    this.running.add(name);
    const started = Date.now();
    try {
      await fn();
      logger.info(`[${name}] 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      logger.error(`[${name}] 出错: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running.delete(name);
    }
  }

  /** 抓取单篇帖子评论并落库（Reddit 经令牌桶限速，HN 内部批量；内容 diff 由 replaceComments 处理） */
  private async fetchAndStoreComments(target: CommentTarget): Promise<void> {
    let fetched: RedditComment[];
    if (target.source === 'hackernews' && this.hackernews) {
      fetched = await this.hackernews.fetchComments(target.id);
    } else if (target.source === 'reddit' && this.reddit) {
      fetched = await this.reddit.fetchComments(target.subreddit, target.id);
    } else {
      return;
    }
    await this.commentsRepo.replaceComments(target.id, fetched, COMMENT_FETCHED_PASS, nowSec());
  }

  /** 后台串行抓取新帖评论（fire-and-forget）：逐篇 await，进程中断遗漏的由 refresh 兜底 */
  private async drainNewComments(targets: CommentTarget[]): Promise<void> {
    for (const t of targets) {
      try {
        await this.fetchAndStoreComments(t);
      } catch (err) {
        logger.warn(
          `[即时评论] ${t.id} 抓取失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 扫描（Reddit hot/new + HN + RSS）：每 30 分钟；新帖触发后台即时评论抓取。
   */
  @Cron('0,30 * * * *')
  scan(): Promise<void> {
    return this.guard('扫描', async () => {
      const fresh: CommentTarget[] = [];

      if (this.reddit && this.subreddits.length > 0) {
        for (const subreddit of this.subreddits) {
          for (const sort of ['hot', 'new'] as const) {
            const posts = await this.reddit.fetchListing(subreddit, sort, 25);
            const { added, updated, newPosts } = await this.postsRepo.upsertPosts(
              posts,
              'reddit',
              nowSec(),
            );
            for (const p of newPosts) {
              fresh.push({ id: p.id, source: 'reddit', subreddit: p.subreddit });
            }
            logger.info(
              `[扫描] r/${subreddit}/${sort}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`,
            );
          }
        }
      }

      if (this.hackernews) {
        for (const section of HN_SECTIONS) {
          const posts = await this.hackernews.fetchStories(section.endpoint, section.channel, 30);
          const { added, updated, newPosts } = await this.postsRepo.upsertPosts(
            posts,
            'hackernews',
            nowSec(),
          );
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
          const { added, updated } = await this.postsRepo.upsertPosts(posts, 'rss', nowSec(), 2);
          logger.info(
            `[扫描] RSS/${feed.name}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`,
          );
        } catch (err) {
          logger.warn(
            `[扫描] RSS/${feed.name} 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (fresh.length > 0) {
        logger.info(`[扫描] 触发 ${fresh.length} 篇新帖即时评论抓取（后台）`);
        void this.drainNewComments(fresh);
      }
    });
  }

  /**
   * 评论补全（Reddit + HN，RSS 跳过）：每 30 分钟，抓未抓过的 + 有界 refresh。
   */
  @Cron('10,40 * * * *')
  comments(): Promise<void> {
    return this.guard('评论补全', async () => {
      const due = await this.postsRepo.getPostsNeedingCommentRefresh(nowSec(), COMMENT_BATCH_LIMIT);
      if (due.length === 0) {
        logger.info(`[评论补全] 暂无待抓/待刷新的帖子`);
        return;
      }
      logger.info(`[评论补全] ${due.length} 篇待抓/刷新评论`);
      for (const post of due) {
        try {
          await this.fetchAndStoreComments({
            id: post.id,
            source: post.source,
            subreddit: post.subreddit,
          });
        } catch (err) {
          logger.error(
            `[评论补全] ${post.id} 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
  }

  /**
   * AI 分析入队：每小时；仅当已选用 active 模型时入队，否则跳过。
   */
  @Cron('20 * * * *')
  analyze(): Promise<void> {
    return this.guard('AI 分析入队', async () => {
      const { active, enqueued, pending } = await this.analysisConfig.enqueueAutoAnalysisRound(
        this.env.analyzeBatchSize,
      );
      if (!active) {
        logger.info('[AI 分析] 未配置 active 模型，跳过自动入队（可在设置页配置）');
        return;
      }
      logger.info(
        `[AI 分析] 入队 ${enqueued} 篇（${pending} 待分析，模型 ${active.label}），交由 worker 处理`,
      );
    });
  }

  /**
   * 历史归档：每天凌晨 3:30，清理 30 天前的原始帖子与评论数据。
   */
  @Cron('30 3 * * *')
  archive(): Promise<void> {
    return this.guard('归档', async () => {
      const cutoff = nowSec() - ARCHIVE_DAYS * 86400;
      const removed = await this.postsRepo.archiveOldData(cutoff);
      logger.info(
        `[归档] 清理 ${ARCHIVE_DAYS} 天前原始数据：帖子 ${removed.posts}，评论 ${removed.comments}（洞察保留）`,
      );
    });
  }
}
