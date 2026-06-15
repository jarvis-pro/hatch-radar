import { AnalysisConfigService } from '../analysis/analysis-config.service';
import { RuntimeSettingsService } from '../config/runtime-settings.service';
import { CrawlerConfigService } from '../crawler/crawler-config.service';
import { HackerNewsClient } from '../crawler/hackernews';
import type { RedditClient, RedditComment } from '../crawler/reddit';
import { fetchFeed } from '../crawler/rss';
import { CommentsRepository } from '../db/comments.repository';
import { JobsRepository } from '../db/jobs.repository';
import { PostsRepository } from '../db/posts.repository';
import { SourcesRepository, type SourceRow } from '../db/sources.repository';
import { logger } from '@hatch-radar/kernel';
import { nowSec } from '@hatch-radar/kernel';

const ARCHIVE_DAYS = 30;
const COMMENT_BATCH_LIMIT = 200;
/** 评论抓取后写入的 comment_pass 值（≥1 表示已抓，可进入分析队列） */
const COMMENT_FETCHED_PASS = 2;

/** HN 端点白名单：DB 里 source.identifier 存的就是端点名，取用前校验 */
const HN_ENDPOINTS = ['topstories', 'askstories', 'showstories'] as const;
type HnEndpoint = (typeof HN_ENDPOINTS)[number];
function asHnEndpoint(s: string): HnEndpoint | null {
  return (HN_ENDPOINTS as readonly string[]).includes(s) ? (s as HnEndpoint) : null;
}

/** 解析 reddit 来源的 config（sorts / limit），缺省回落 hot+new / 25 */
function redditSourceConfig(source: SourceRow): { sorts: ('hot' | 'new')[]; limit: number } {
  const cfg = (source.config ?? {}) as { sorts?: unknown; limit?: unknown };
  const sorts = Array.isArray(cfg.sorts)
    ? (cfg.sorts.filter((s) => s === 'hot' || s === 'new') as ('hot' | 'new')[])
    : [];
  const limit = typeof cfg.limit === 'number' && cfg.limit > 0 ? cfg.limit : 25;
  return { sorts: sorts.length > 0 ? sorts : ['hot', 'new'], limit };
}

/** 评论抓取目标：source 决定用哪个客户端，subreddit 供 Reddit 评论接口 */
interface CommentTarget {
  id: string;
  source: string;
  subreddit: string;
}

/**
 * 定时调度服务：扫描 / 评论补全 / AI 分析入队 / 归档。
 *
 * - cron 由 app 侧的调度类触发（NestJS：@nestjs/schedule 的 @Cron，见 apps/server/src/scheduler/scheduler.cron.ts），各自调用本服务方法。
 * - 同名任务不并发由 {@link guard} 保证（沿用裸跑的非重入语义）。
 * - 初始化轮次由 app 侧启动钩子调用 {@link runInitialRound}（NestJS：onApplicationBootstrap）。
 * - guard 是进程内内存态、无分布式锁 → 本服务（HTTP + 调度进程）须**单实例**部署。
 */
export class SchedulerService {
  /** 正在执行的任务名集合（同名不并发） */
  private readonly running = new Set<string>();

  constructor(
    private readonly crawlerConfig: CrawlerConfigService,
    private readonly hackernews: HackerNewsClient,
    private readonly sourcesRepo: SourcesRepository,
    private readonly postsRepo: PostsRepository,
    private readonly commentsRepo: CommentsRepository,
    private readonly jobsRepo: JobsRepository,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  /** 启动后的一次性初始化轮次：扫描 → 评论补全 → 分析入队 */
  async runInitialRound(): Promise<void> {
    logger.info('启动初始化轮次：扫描 → 评论补全 → AI 分析入队');
    await this.scan();
    await this.comments();
    await this.analyze();
    logger.info('初始化轮次完成，进入定时调度（洞察可在 web 控制台查看）');
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
  private async fetchAndStoreComments(
    target: CommentTarget,
    reddit: RedditClient | null,
  ): Promise<void> {
    let fetched: RedditComment[];
    if (target.source === 'hackernews') {
      fetched = await this.hackernews.fetchComments(target.id);
    } else if (target.source === 'reddit' && reddit) {
      fetched = await reddit.fetchComments(target.subreddit, target.id);
    } else {
      return;
    }
    await this.commentsRepo.replaceComments(target.id, fetched, COMMENT_FETCHED_PASS, nowSec());
  }

  /** 后台串行抓取新帖评论（fire-and-forget）：逐篇 await，进程中断遗漏的由 refresh 兜底 */
  private async drainNewComments(
    targets: CommentTarget[],
    reddit: RedditClient | null,
  ): Promise<void> {
    for (const t of targets) {
      try {
        await this.fetchAndStoreComments(t, reddit);
      } catch (err) {
        logger.warn(
          `[即时评论] ${t.id} 抓取失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 扫描（Reddit hot/new + HN + RSS）：每 30 分钟；新帖触发后台即时评论抓取。
   * cron: '0,30 * * * *'（见 scheduler/jobs.ts 的 ScanJob）。
   */
  scan(): Promise<void> {
    return this.guard('扫描', async () => {
      const fresh: CommentTarget[] = [];
      const reddit = await this.crawlerConfig.getRedditClient();

      const redditSources = await this.sourcesRepo.listEnabledByPlatform('reddit');
      if (redditSources.length > 0 && !reddit) {
        logger.warn('[扫描] 有启用的 Reddit 来源但无可用连接器（未配置/未测试通过），跳过 Reddit');
      }
      if (reddit) {
        for (const source of redditSources) {
          const { sorts, limit } = redditSourceConfig(source);
          for (const sort of sorts) {
            // 单个版块失败（如被封 / 改名 / 私有触发 403/404）只跳过该项，不中断整轮扫描
            try {
              const posts = await reddit.fetchListing(source.identifier, sort, limit);
              const { added, updated, newPosts } = await this.postsRepo.upsertPosts(
                posts,
                'reddit',
                nowSec(),
              );
              for (const p of newPosts) {
                fresh.push({ id: p.id, source: 'reddit', subreddit: p.subreddit });
              }
              logger.info(
                `[扫描] r/${source.identifier}/${sort}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`,
              );
            } catch (err) {
              logger.warn(
                `[扫描] r/${source.identifier}/${sort} 失败: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
      }

      for (const source of await this.sourcesRepo.listEnabledByPlatform('hackernews')) {
        const endpoint = asHnEndpoint(source.identifier);
        if (!endpoint) {
          logger.warn(`[扫描] HN 来源 #${source.id} 端点非法（${source.identifier}），跳过`);
          continue;
        }
        const channel = source.label || endpoint;
        // 单个分区失败只跳过该分区，不影响其余分区与后续 RSS 抓取
        try {
          const posts = await this.hackernews.fetchStories(endpoint, channel, 30);
          const { added, updated, newPosts } = await this.postsRepo.upsertPosts(
            posts,
            'hackernews',
            nowSec(),
          );
          for (const p of newPosts) {
            fresh.push({ id: p.id, source: 'hackernews', subreddit: p.subreddit });
          }
          logger.info(`[扫描] HN/${channel}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`);
        } catch (err) {
          logger.warn(
            `[扫描] HN/${channel} 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // RSS（无评论，直接设 comment_pass=2 进入分析队列；不触发评论抓取）
      for (const source of await this.sourcesRepo.listEnabledByPlatform('rss')) {
        const name = source.label || source.identifier;
        try {
          const posts = await fetchFeed({ name, url: source.identifier }, 20);
          const { added, updated } = await this.postsRepo.upsertPosts(posts, 'rss', nowSec(), 2);
          logger.info(`[扫描] RSS/${name}: 抓取 ${posts.length}，新增 ${added}，更新 ${updated}`);
        } catch (err) {
          logger.warn(`[扫描] RSS/${name} 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (fresh.length > 0) {
        logger.info(`[扫描] 触发 ${fresh.length} 篇新帖即时评论抓取（后台）`);
        void this.drainNewComments(fresh, reddit);
      }
    });
  }

  /** 评论补全（Reddit + HN，RSS 跳过）：每 30 分钟。cron: '10,40 * * * *'。 */
  comments(): Promise<void> {
    return this.guard('评论补全', async () => {
      const due = await this.postsRepo.getPostsNeedingCommentRefresh(nowSec(), COMMENT_BATCH_LIMIT);
      if (due.length === 0) {
        logger.info(`[评论补全] 暂无待抓/待刷新的帖子`);
        return;
      }
      const reddit = await this.crawlerConfig.getRedditClient();
      logger.info(`[评论补全] ${due.length} 篇待抓/刷新评论`);
      for (const post of due) {
        try {
          await this.fetchAndStoreComments(
            { id: post.id, source: post.source, subreddit: post.subreddit },
            reddit,
          );
        } catch (err) {
          logger.error(
            `[评论补全] ${post.id} 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
  }

  /** AI 分析入队：每小时；仅当已选用 active 模型时入队。cron: '20 * * * *'。 */
  analyze(): Promise<void> {
    return this.guard('AI 分析入队', async () => {
      const { active, enqueued, pending } = await this.analysisConfig.enqueueAutoAnalysisRound(
        await this.runtimeSettings.getAnalyzeBatchSize(),
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

  /** 历史归档：每天凌晨 3:30，清理 30 天前的原始帖子与评论数据。cron: '30 3 * * *'。 */
  archive(): Promise<void> {
    return this.guard('归档', async () => {
      const cutoff = nowSec() - ARCHIVE_DAYS * 86400;
      const removed = await this.postsRepo.archiveOldData(cutoff);
      const removedJobs = await this.jobsRepo.deleteFinishedJobsBefore(cutoff);
      logger.info(
        `[归档] 清理 ${ARCHIVE_DAYS} 天前原始数据：帖子 ${removed.posts}，评论 ${removed.comments}，终态分析任务 ${removedJobs}（洞察保留）`,
      );
    });
  }
}
