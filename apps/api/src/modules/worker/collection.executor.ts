import { Injectable } from '@nestjs/common';
import { AnalysisConfigService } from '@/modules/analysis/analysis-config.service';
import {
  CrawlerConfigService,
  HackerNewsClient,
  fetchFeed,
  type CommentFetchResult,
} from '@/crawler';
import {
  CommentsRepository,
  PostsRepository,
  RunsRepository,
  SourcesRepository,
  TasksRepository,
  type PostRow,
  type SourceRow,
  type TaskRow,
} from '@/database';
import { logger } from '@/logger';
import { nowSec } from '@/utils/time';
import { errMsg } from '@/utils/error';
import { buildStages, type RedditComment, type StageRecipe } from '@hatch-radar/shared';
import { RequestGate } from './request-gate';

/** 评论抓取后写入的 comment_pass 值（≥1 即可进入分析） */
const COMMENT_FETCHED_PASS = 2;
/** HN 端点白名单 */
const HN_ENDPOINTS = ['topstories', 'askstories', 'showstories'] as const;
type HnEndpoint = (typeof HN_ENDPOINTS)[number];
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

/** 从任务 params（JsonValue）安全读出当前复查 sweep 序号；缺省 0 */
function readSweep(params: unknown): number {
  if (params && typeof params === 'object' && 'sweep' in params) {
    const s = (params as { sweep?: unknown }).sweep;
    if (typeof s === 'number') {
      return s;
    }
  }

  return 0;
}

/** 上游环节产物读取的最小形状（worker 传入的 task_stages 满足）。 */
type StageLike = { name: string; output: unknown };

/** 取某上游环节已落库的产物（检查点）；未跑 / 无产物为 undefined。 */
function stageOutput<T>(stages: readonly StageLike[], name: string): T | undefined {
  const out = stages.find((s) => s.name === name)?.output;

  return (out ?? undefined) as T | undefined;
}

/** discover.fetch_listing 产物：抓列表 + upsert 后的新帖 id 与计数。 */
export interface DiscoverListingOutput {
  newPostIds: string[];
  added: number;
  updated: number;
  sourcesFetched: number;
}
/** discover.dedup 产物：待派生采集的新帖 id（活跃任务去重由 createTaskWithStages 兜底）。 */
export interface DiscoverDedupOutput {
  toSpawn: string[];
}
/** discover.spawn 产物：派生的 collect 任务数。 */
export interface DiscoverSpawnOutput {
  collectSpawned: number;
}
/** collect.fetch_comments / recheck.recrawl 产物：抓回的评论（jsonb 检查点，persist 据此落库）。 */
export interface FetchCommentsOutput {
  source: string;
  commentCount: number;
  dropped: number;
  comments: RedditComment[];
}
/** collect.persist 产物。 */
export interface CollectPersistOutput {
  commentCount: number;
  dropped: number;
  analyzeSpawned: boolean;
}
/** recheck.persist 产物。 */
export interface RecheckPersistOutput {
  changed: boolean;
  analyzeSpawned: boolean;
}

/**
 * 采集执行器（worker 侧）：承载图纸生命周期里 discover / collect / recheck 任务的**逐环节**抓取与落库。
 *
 * 环节拆分（与 {@link buildStages} 的模板一致），每环节产物落 task_stages.output 做检查点：
 * - discover：fetch_listing（抓所有启用源列表 + upsertPosts → 新帖 id）→ dedup → spawn（为新帖派生 collect）
 * - collect：fetch_comments（抓评论树，落 jsonb 检查点）→ persist（replaceComments + 派生 analyze）
 * - recheck：recrawl（重抓评论）→ persist（replaceComments 指纹判变 + 指数退避 + 变则派生 analyze）
 *
 * 「抓取/落库分环节」让任意环节可挂暂停点（task_stages.gate），且重认领从下一环节续跑（检查点不丢、所见即所跑）。
 * 派生用 {@link TasksRepository.createTaskWithStages}，同帖同 kind 已有活跃任务即去重跳过。抓取经请求闸（lane 限速 / 可暂停）。
 */
@Injectable()
export class CollectionExecutor {
  constructor(
    // 采集配置服务：按连接器取已认证的 Reddit 客户端
    private readonly crawlerConfig: CrawlerConfigService,
    // HackerNews 客户端：抓 HN 列表 + 评论
    private readonly hackernews: HackerNewsClient,
    // 采集来源仓储：按平台列出启用来源（爬虫计划）
    private readonly sources: SourcesRepository,
    // 帖子仓储：upsert 列表帖 + 复查退避状态更新
    private readonly posts: PostsRepository,
    // 评论仓储：replaceComments 落评论树 + 指纹判变
    private readonly comments: CommentsRepository,
    // 任务仓储：派生 collect / analyze 子任务（带活跃去重）
    private readonly tasks: TasksRepository,
    // 运行仓储：run 级计数累加 + 读运行参数快照（图纸配方）
    private readonly runs: RunsRepository,
    // 分析配置服务：派生 analyze 前确认存在 active 模型
    private readonly analysisConfig: AnalysisConfigService,
    // 出站请求闸：每次外站抓取经此（lane 限速 / 可暂停 / 流水可见）
    private readonly gate: RequestGate,
  ) {}

  // ─── discover：抓列表 → 去重 → 派生采集 ───────────────────────────────────────

  /** 按环节名分派 discover 任务的执行。 */
  runDiscoverStage(name: string, task: TaskRow, stages: readonly StageLike[]): Promise<unknown> {
    switch (name) {
      case 'fetch_listing':
        return this.discoverFetchListing();
      case 'dedup':
        return Promise.resolve(this.discoverDedup(stages));
      case 'spawn':
        return this.discoverSpawn(task, stages);
      default:
        return Promise.reject(new Error(`未知 discover 环节: ${name}`));
    }
  }

  /** fetch_listing：抓所有启用源列表 + upsertPosts；产物 = 新帖 id + 计数（检查点）。 */
  private async discoverFetchListing(): Promise<DiscoverListingOutput> {
    const now = nowSec();
    let added = 0;
    let updated = 0;
    let sourcesFetched = 0;
    const newPostIds: string[] = [];

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
            for (const p of r.newPosts) {
              newPostIds.push(p.id);
            }
          } catch (err) {
            logger.warn(`[采集] r/${source.identifier}/${sort} 失败: ${errMsg(err)}`);
          }
        }
      }
    }

    for (const source of await this.sources.listEnabledByPlatform('hackernews')) {
      const endpoint = asHnEndpoint(source.identifier);
      if (!endpoint) {
        continue;
      }

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
        for (const p of r.newPosts) {
          newPostIds.push(p.id);
        }
      } catch (err) {
        logger.warn(`[采集] HN/${channel} 失败: ${errMsg(err)}`);
      }
    }

    // RSS 无评论：upsert 时 comment_pass=2，新帖仍派生 collect（其 fetch_comments 空评论、直接派生分析）
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
        for (const p of r.newPosts) {
          newPostIds.push(p.id);
        }
      } catch (err) {
        logger.warn(`[采集] RSS/${name} 失败: ${errMsg(err)}`);
      }
    }

    logger.info(
      `[采集] discover fetch_listing：来源 ${sourcesFetched}，新增 ${added}，更新 ${updated}`,
    );

    return { newPostIds, added, updated, sourcesFetched };
  }

  /** dedup：读 fetch_listing 检查点，候选 = 新帖 id（活跃任务去重交 createTaskWithStages 兜底）。 */
  private discoverDedup(stages: readonly StageLike[]): DiscoverDedupOutput {
    const listing = stageOutput<DiscoverListingOutput>(stages, 'fetch_listing');

    return { toSpawn: listing?.newPostIds ?? [] };
  }

  /** spawn：读 dedup 检查点，为每条新帖派生 collect 子任务（撞活跃唯一索引者跳过）。 */
  private async discoverSpawn(
    task: TaskRow,
    stages: readonly StageLike[],
  ): Promise<DiscoverSpawnOutput> {
    const dedup = stageOutput<DiscoverDedupOutput>(stages, 'dedup');
    const ids = dedup?.toSpawn ?? [];
    const now = nowSec();
    const recipe = await this.recipeForRun(task.run_id);
    let collectSpawned = 0;
    for (const postId of ids) {
      const res = await this.tasks.createTaskWithStages(
        {
          runId: task.run_id,
          processId: task.process_id,
          kind: 'collect',
          parentTaskId: task.id,
          postId,
        },
        buildStages('collect', recipe),
        now,
      );
      if (res.ok) {
        collectSpawned += 1;
      }
    }

    if (collectSpawned > 0) {
      await this.runs.incrementCounters(task.run_id, { total: collectSpawned });
    }

    logger.info(`[采集] discover spawn：派生采集 ${collectSpawned}`);

    return { collectSpawned };
  }

  // ─── collect：抓评论 → 落库 + 派生分析 ────────────────────────────────────────

  /** 按环节名分派 collect 任务的执行。 */
  runCollectStage(
    name: string,
    task: TaskRow,
    post: PostRow,
    stages: readonly StageLike[],
  ): Promise<unknown> {
    switch (name) {
      case 'fetch_comments':
        return this.fetchCommentsStage(task, post);
      case 'persist':
        return this.collectPersist(task, post, stages);
      default:
        return Promise.reject(new Error(`未知 collect 环节: ${name}`));
    }
  }

  /** persist：读 fetch_comments 检查点 → replaceComments + 派生 analyze。 */
  private async collectPersist(
    task: TaskRow,
    post: PostRow,
    stages: readonly StageLike[],
  ): Promise<CollectPersistOutput> {
    const now = nowSec();
    const fetched = stageOutput<FetchCommentsOutput>(stages, 'fetch_comments');
    const comments = fetched?.comments ?? [];
    // rss 无评论：comments 空，replaceComments 仅推进 comment_pass
    await this.comments.replaceComments(post.id, comments, COMMENT_FETCHED_PASS, now);
    const analyzeSpawned = await this.spawnAnalyze(
      task.run_id,
      post.id,
      task.id,
      now,
      task.process_id,
    );
    logger.info(
      `[采集] collect ${post.id}：评论 ${comments.length}，派生分析 ${analyzeSpawned ? '是' : '否'}`,
    );

    return { commentCount: comments.length, dropped: fetched?.dropped ?? 0, analyzeSpawned };
  }

  // ─── recheck：重抓评论 → 落库（判变 + 退避 + 变则重新分析） ──────────────────────

  /** 按环节名分派 recheck 任务的执行。 */
  runRecheckStage(
    name: string,
    task: TaskRow,
    post: PostRow,
    stages: readonly StageLike[],
  ): Promise<unknown> {
    switch (name) {
      case 'recrawl':
        return this.fetchCommentsStage(task, post);
      case 'persist':
        return this.recheckPersist(task, post, stages);
      default:
        return Promise.reject(new Error(`未知 recheck 环节: ${name}`));
    }
  }

  /**
   * persist：读 recrawl 检查点 → replaceComments 内置指纹 diff 判有无变化。
   * 有变化：comments_changed_at 已更新 + 退避复位（misses=0、下轮即查）+ 派生重新分析。
   * 无变化：指数退避（misses++、跳过 min(2^(misses-1), CAP) 个 sweep）。rss 不在复查范围。
   */
  private async recheckPersist(
    task: TaskRow,
    post: PostRow,
    stages: readonly StageLike[],
  ): Promise<RecheckPersistOutput> {
    const now = nowSec();
    const sweep = readSweep(task.params);
    const fetched = stageOutput<FetchCommentsOutput>(stages, 'recrawl');
    const comments = fetched?.comments ?? [];
    const { changed } = await this.comments.replaceComments(
      post.id,
      comments,
      COMMENT_FETCHED_PASS,
      now,
    );
    let analyzeSpawned = false;
    if (changed) {
      await this.posts.updateRecheckState(post.id, {
        misses: 0,
        dueSweep: sweep + 1,
        lastRecheckedAt: now,
      });
      analyzeSpawned = await this.spawnAnalyze(task.run_id, post.id, task.id, now, task.process_id);
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

  // ─── 共用 ────────────────────────────────────────────────────────────────────

  /** 抓单帖评论（reddit/hn 经请求闸；rss / 无 reddit 客户端 → null）。供 collect.fetch_comments / recheck.recrawl 复用。 */
  private async fetchCommentsStage(task: TaskRow, post: PostRow): Promise<FetchCommentsOutput> {
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

    return {
      source: post.source,
      commentCount: result?.comments.length ?? 0,
      dropped: result?.dropped ?? 0,
      comments: result?.comments ?? [],
    };
  }

  /** 派生一条 analyze 任务（有 active 模型且同帖无活跃 analyze 任务时）；环节闸门取该运行的图纸配方。 */
  private async spawnAnalyze(
    runId: number,
    postId: string,
    parentTaskId: number,
    now: number,
    processId: number | null,
  ): Promise<boolean> {
    const active = await this.analysisConfig.getActiveProvider();
    if (!active) {
      return false;
    }

    const recipe = await this.recipeForRun(runId);
    const res = await this.tasks.createTaskWithStages(
      {
        runId,
        processId,
        kind: 'analyze',
        parentTaskId,
        postId,
        providerId: active.id,
        model: active.model,
      },
      buildStages('analyze', recipe),
      now,
    );
    if (res.ok) {
      await this.runs.incrementCounters(runId, { total: 1 });
    }

    return res.ok;
  }

  /** 从运行的 params 快照读出建环节配方（gates / enabledStages）——派生任务的闸门据此与图纸一致。 */
  private async recipeForRun(runId: number): Promise<StageRecipe> {
    const run = await this.runs.getRun(runId);
    const p = (run?.params ?? {}) as { gates?: unknown; enabledStages?: unknown };
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

    return { gates: arr(p.gates), enabledStages: arr(p.enabledStages) };
  }
}
