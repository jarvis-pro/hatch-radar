import { AnalysisConfigService } from '@hatch-radar/analysis';
import {
  CrawlerConfigService,
  HackerNewsClient,
  fetchFeed,
  type CommentFetchResult,
} from '@hatch-radar/crawler';
import {
  CommentsRepository,
  PostsRepository,
  RunsRepository,
  SourcesRepository,
  TasksRepository,
  type PostRow,
  type SourceRow,
  type TaskRow,
} from '@hatch-radar/db';
import { logger, nowSec } from '@hatch-radar/kernel';
import { INSPECT_STEP_NAMES } from '@hatch-radar/shared';
import { RequestGate } from './request-gate';

/** 评论抓取后写入的 comment_pass 值（≥1 即可进入分析） */
const COMMENT_FETCHED_PASS = 2;
/** HN 端点白名单 */
const HN_ENDPOINTS = ['topstories', 'askstories', 'showstories'] as const;
type HnEndpoint = (typeof HN_ENDPOINTS)[number];
/** analyze 任务环节模板（= 检视器 6 节点，无闸门→运行到底） */
const ANALYZE_STAGES = INSPECT_STEP_NAMES.map((name) => ({ name }));
/** collect 任务环节模板（单环节：抓评论 + 派生分析） */
const COLLECT_STAGES = [{ name: 'fetch_comments' }];
/** 复查指数退避封顶：连续未变最多跳过的 sweep 数 */
const RECHECK_BACKOFF_CAP = 16;

function asHnEndpoint(s: string): HnEndpoint | null {
  return (HN_ENDPOINTS as readonly string[]).includes(s) ? (s as HnEndpoint) : null;
}

/** 解析 reddit 来源 config（sorts / limit），缺省回落 hot+new / 25 */
function redditSourceConfig(source: SourceRow): { sorts: ('hot' | 'new')[]; limit: number } {
  const cfg = (source.config ?? {}) as { sorts?: unknown; limit?: unknown };
  const sorts = Array.isArray(cfg.sorts)
    ? (cfg.sorts.filter((s) => s === 'hot' || s === 'new') as ('hot' | 'new')[])
    : [];
  const limit = typeof cfg.limit === 'number' && cfg.limit > 0 ? cfg.limit : 25;
  return { sorts: sorts.length > 0 ? sorts : ['hot', 'new'], limit };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 从任务 params（JsonValue）安全读出当前复查 sweep 序号；缺省 0 */
function readSweep(params: unknown): number {
  if (params && typeof params === 'object' && 'sweep' in params) {
    const s = (params as { sweep?: unknown }).sweep;
    if (typeof s === 'number') return s;
  }
  return 0;
}

/** discover 环节产物 */
export interface DiscoverOutput {
  sourcesFetched: number;
  added: number;
  updated: number;
  collectSpawned: number;
}

/** collect 环节产物 */
export interface CollectOutput {
  source: string;
  commentCount: number;
  dropped: number;
  analyzeSpawned: boolean;
}

/** recheck 环节产物 */
export interface RecheckOutput {
  changed: boolean;
  analyzeSpawned: boolean;
}

/**
 * 采集执行器（worker 侧）：承载图纸生命周期里 discover / collect 两类任务环节的实际抓取。
 *
 * - discover：抓所有启用来源的列表 → upsertPosts（去重靠 upsert 返回的 newPosts）→ 为每条新帖派生 collect 任务。
 * - collect：抓单帖评论（reddit/hn；rss 跳过）→ replaceComments → 派生 analyze 任务（采集即分析）。
 *
 * 派生用 {@link TasksRepository.createTaskWithStages}，同帖同 kind 已有活跃任务即去重跳过（故环节重跑幂等）。
 * 抓取经各自的 crawler 客户端（内含令牌桶限速）。
 */
export class CollectionExecutor {
  constructor(
    private readonly crawlerConfig: CrawlerConfigService,
    private readonly hackernews: HackerNewsClient,
    private readonly sources: SourcesRepository,
    private readonly posts: PostsRepository,
    private readonly comments: CommentsRepository,
    private readonly tasks: TasksRepository,
    private readonly runs: RunsRepository,
    private readonly analysisConfig: AnalysisConfigService,
    private readonly gate: RequestGate,
  ) {}

  /** discover 环节：抓列表 + upsert + 为新帖派生 collect 任务。 */
  async discover(task: TaskRow): Promise<DiscoverOutput> {
    const runId = task.run_id;
    const now = nowSec();
    let added = 0;
    let updated = 0;
    let sourcesFetched = 0;
    const fresh: { id: string; subreddit: string }[] = [];

    const reddit = await this.crawlerConfig.getRedditClient();
    if (reddit) {
      for (const source of await this.sources.listEnabledByPlatform('reddit')) {
        const { sorts, limit } = redditSourceConfig(source);
        for (const sort of sorts) {
          try {
            const posts = await this.gate.run(
              { lane: 'reddit', purpose: 'listing', url: `r/${source.identifier}/${sort}` },
              () => reddit.fetchListing(source.identifier, sort, limit),
            );
            const r = await this.posts.upsertPosts(posts, 'reddit', now);
            added += r.added;
            updated += r.updated;
            sourcesFetched += 1;
            for (const p of r.newPosts) fresh.push(p);
          } catch (err) {
            logger.warn(`[采集] r/${source.identifier}/${sort} 失败: ${errMsg(err)}`);
          }
        }
      }
    }

    for (const source of await this.sources.listEnabledByPlatform('hackernews')) {
      const endpoint = asHnEndpoint(source.identifier);
      if (!endpoint) continue;
      const channel = source.label || endpoint;
      try {
        const posts = await this.gate.run(
          { lane: 'hackernews', purpose: 'listing', url: `hn/${endpoint}` },
          () => this.hackernews.fetchStories(endpoint, channel, 30),
        );
        const r = await this.posts.upsertPosts(posts, 'hackernews', now);
        added += r.added;
        updated += r.updated;
        sourcesFetched += 1;
        for (const p of r.newPosts) fresh.push(p);
      } catch (err) {
        logger.warn(`[采集] HN/${channel} 失败: ${errMsg(err)}`);
      }
    }

    // RSS 无评论：upsert 时 comment_pass=2，新帖仍派生 collect（其 fetch_comments 跳过抓取、直接派生分析）
    for (const source of await this.sources.listEnabledByPlatform('rss')) {
      const name = source.label || source.identifier;
      try {
        const posts = await this.gate.run(
          { lane: 'rss', purpose: 'listing', url: source.identifier },
          () => fetchFeed({ name, url: source.identifier }, 20),
        );
        const r = await this.posts.upsertPosts(posts, 'rss', now, COMMENT_FETCHED_PASS);
        added += r.added;
        updated += r.updated;
        sourcesFetched += 1;
        for (const p of r.newPosts) fresh.push(p);
      } catch (err) {
        logger.warn(`[采集] RSS/${name} 失败: ${errMsg(err)}`);
      }
    }

    let collectSpawned = 0;
    for (const p of fresh) {
      const res = await this.tasks.createTaskWithStages(
        { runId, kind: 'collect', parentTaskId: task.id, postId: p.id },
        COLLECT_STAGES,
        now,
      );
      if (res.ok) collectSpawned += 1;
    }
    if (collectSpawned > 0) await this.runs.incrementCounters(runId, { total: collectSpawned });
    logger.info(
      `[采集] discover：来源 ${sourcesFetched}，新增 ${added}，更新 ${updated}，派生采集 ${collectSpawned}`,
    );
    return { sourcesFetched, added, updated, collectSpawned };
  }

  /** collect 环节：抓单帖评论（rss 跳过）+ replaceComments + 派生 analyze 任务。 */
  async collectComments(task: TaskRow, post: PostRow): Promise<CollectOutput> {
    const now = nowSec();
    let result: CommentFetchResult | null = null;
    if (post.source === 'hackernews') {
      result = await this.gate.run(
        { lane: 'hackernews', purpose: 'comments', url: post.id, ownerTaskId: task.id },
        () => this.hackernews.fetchComments(post.id),
      );
    } else if (post.source === 'reddit') {
      const reddit = await this.crawlerConfig.getRedditClient();
      if (reddit) {
        result = await this.gate.run(
          { lane: 'reddit', purpose: 'comments', url: post.id, ownerTaskId: task.id },
          () => reddit.fetchComments(post.subreddit, post.id),
        );
      }
    }
    let commentCount = 0;
    let dropped = 0;
    if (result) {
      commentCount = result.comments.length;
      dropped = result.dropped;
      await this.comments.replaceComments(post.id, result.comments, COMMENT_FETCHED_PASS, now);
    }
    const analyzeSpawned = await this.spawnAnalyze(task.run_id, post.id, task.id, now);
    logger.info(
      `[采集] collect ${post.id}：评论 ${commentCount}${dropped > 0 ? ` (丢弃≈${dropped})` : ''}，派生分析 ${analyzeSpawned ? '是' : '否'}`,
    );
    return { source: post.source, commentCount, dropped, analyzeSpawned };
  }

  /**
   * recheck 环节：复查单帖——抓评论（经闸）→ replaceComments 内置指纹 diff 判有无变化。
   * 有变化：comments_changed_at 已更新 + 派生重新分析 + 退避复位（misses=0、下轮即查）。
   * 无变化：指数退避（misses++、跳过 min(2^(misses-1), CAP) 个 sweep）。rss 不在复查范围。
   */
  async recheckPost(task: TaskRow, post: PostRow): Promise<RecheckOutput> {
    const now = nowSec();
    const sweep = readSweep(task.params);
    let result: CommentFetchResult | null = null;
    if (post.source === 'hackernews') {
      result = await this.gate.run(
        { lane: 'hackernews', purpose: 'recheck', url: post.id, ownerTaskId: task.id },
        () => this.hackernews.fetchComments(post.id),
      );
    } else if (post.source === 'reddit') {
      const reddit = await this.crawlerConfig.getRedditClient();
      if (reddit) {
        result = await this.gate.run(
          { lane: 'reddit', purpose: 'recheck', url: post.id, ownerTaskId: task.id },
          () => reddit.fetchComments(post.subreddit, post.id),
        );
      }
    }
    const changed = result
      ? (await this.comments.replaceComments(post.id, result.comments, COMMENT_FETCHED_PASS, now))
          .changed
      : false;
    let analyzeSpawned = false;
    if (changed) {
      await this.posts.updateRecheckState(post.id, {
        misses: 0,
        dueSweep: sweep + 1,
        lastRecheckedAt: now,
      });
      analyzeSpawned = await this.spawnAnalyze(task.run_id, post.id, task.id, now);
    } else {
      const misses = post.recheck_misses + 1;
      const skip = Math.min(2 ** (misses - 1), RECHECK_BACKOFF_CAP);
      await this.posts.updateRecheckState(post.id, {
        misses,
        dueSweep: sweep + skip,
        lastRecheckedAt: now,
      });
    }
    logger.info(
      `[复查] ${post.id} sweep#${sweep}：${changed ? '有变化→重抓+重新分析' : '无变化→退避'}`,
    );
    return { changed, analyzeSpawned };
  }

  /** 派生一条 analyze 任务（有 active 模型且同帖无活跃 analyze 任务时）。 */
  private async spawnAnalyze(
    runId: number,
    postId: string,
    parentTaskId: number,
    now: number,
  ): Promise<boolean> {
    const active = await this.analysisConfig.getActiveProvider();
    if (!active) return false;
    const res = await this.tasks.createTaskWithStages(
      { runId, kind: 'analyze', parentTaskId, postId, providerId: active.id, model: active.model },
      ANALYZE_STAGES,
      now,
    );
    if (res.ok) await this.runs.incrementCounters(runId, { total: 1 });
    return res.ok;
  }
}
