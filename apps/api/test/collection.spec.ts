import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle, PostRow, TaskRow } from '@/database';
import {
  BlueprintsRepository,
  CommentsRepository,
  PostsRepository,
  RequestLanesRepository,
  RequestQueueRepository,
  RunsRepository,
  SourcesRepository,
  TasksRepository,
} from '@/database';
import type { AnalysisConfigService } from '@/domain/analysis/analysis-config.service';
import type { CrawlerConfigService, HackerNewsClient } from '@/crawler';
import { buildStages, type TaskKind, type RedditPost } from '@hatch-radar/shared';
import { nowSec } from '@/utils/time';
import {
  CollectionExecutor,
  type CollectPersistOutput,
  type DiscoverListingOutput,
  type DiscoverSpawnOutput,
  type FetchCommentsOutput,
  type RecheckPersistOutput,
} from '../src/domain/worker/collection.executor';
import { RequestGate } from '../src/domain/worker/request-gate';
import { setupTestDb, truncateAll } from './helpers';

type ActiveProvider = { id: number; model: string; label: string } | null;

/**
 * 采集执行器闭环测试（不依赖前端）：discover / collect / recheck 现已**拆成多环节**，逐环节落检查点。
 * 测试按 worker 的环节循环驱动（依次执行各环节、把产物累加进 stages 供下游读检查点），验证：
 * discover 抓列表 upsert 新帖 + 派生 collect；collect 抓评论 → 落库 + 派生 analyze；recheck 判变 + 退避。
 * crawler 客户端 / AnalysisConfig 用桩隔离，仓储真连 PG。
 */
describe('采集执行器（CollectionExecutor：逐环节 discover → collect → recheck）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let sources: SourcesRepository;
  let posts: PostsRepository;
  let comments: CommentsRepository;
  let tasks: TasksRepository;
  let runs: RunsRepository;
  let blueprints: BlueprintsRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    sources = new SourcesRepository(db);
    posts = new PostsRepository(db);
    comments = new CommentsRepository(db);
    tasks = new TasksRepository(db);
    runs = new RunsRepository(db);
    blueprints = new BlueprintsRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  /** 桩执行器：reddit 列表由 listing 注入、active 模型由 active 注入；其余 crawler 客户端不被调用。 */
  function makeExecutor(opts: {
    listing?: RedditPost[];
    active?: ActiveProvider;
  }): CollectionExecutor {
    const fakeReddit = {
      fetchListing: () => Promise.resolve(opts.listing ?? []),
      fetchComments: () => Promise.resolve({ comments: [], dropped: 0 }),
    };
    const crawlerConfig = {
      getRedditClient: () => Promise.resolve(fakeReddit),
    } as unknown as CrawlerConfigService;
    const hackernews = {} as unknown as HackerNewsClient;
    const analysisConfig = {
      getActiveProvider: () => Promise.resolve(opts.active ?? null),
    } as unknown as AnalysisConfigService;
    const gate = new RequestGate(new RequestQueueRepository(db), new RequestLanesRepository(db));
    return new CollectionExecutor(
      crawlerConfig,
      hackernews,
      sources,
      posts,
      comments,
      tasks,
      runs,
      analysisConfig,
      gate,
    );
  }

  /** 模拟 worker 的环节循环：依次跑完一个任务的全部环节，把每环节产物累加进 stages 供下游读检查点。 */
  async function runStages(
    exec: CollectionExecutor,
    kind: TaskKind,
    task: TaskRow,
    post: PostRow | null,
  ): Promise<Record<string, unknown>> {
    const stages: { name: string; output: unknown }[] = [];
    for (const s of buildStages(kind)) {
      const out =
        kind === 'discover'
          ? await exec.runDiscoverStage(s.name, task, stages)
          : kind === 'collect'
            ? await exec.runCollectStage(s.name, task, post!, stages)
            : await exec.runRecheckStage(s.name, task, post!, stages);
      stages.push({ name: s.name, output: out });
    }
    return Object.fromEntries(stages.map((x) => [x.name, x.output]));
  }

  /** 建一条 collect 运行，返回 runId。 */
  async function makeRun(): Promise<number> {
    const bp = await blueprints.createBlueprint({ kind: 'collect', label: '采集' }, nowSec());
    const run = await runs.createRun(
      { blueprintId: bp.id, kind: 'collect', triggerSource: 'manual' },
      nowSec(),
    );
    return run.id;
  }

  /** 建一个 kind 任务（多环节由 buildStages 展开），返回其 TaskRow。 */
  async function makeTask(
    runId: number,
    kind: TaskKind,
    extra: { postId?: string; params?: unknown } = {},
  ): Promise<TaskRow> {
    const res = await tasks.createTaskWithStages(
      { runId, kind, postId: extra.postId, params: extra.params },
      buildStages(kind),
      nowSec(),
    );
    if (!res.ok) throw new Error(res.error);
    return (await tasks.getTask(res.taskId))!;
  }

  it('discover：fetch_listing→dedup→spawn 抓列表 upsert 新帖并派生 collect 任务', async () => {
    await db.sources.create({
      data: {
        platform: 'reddit',
        identifier: 'SaaS',
        label: '',
        enabled: true,
        config: { sorts: ['hot'], limit: 5 },
        created_at: 0n,
        updated_at: 0n,
      },
    });
    const post: RedditPost = {
      id: 'rd_t1',
      subreddit: 'SaaS',
      title: 'New post',
      author: 'u',
      selftext: 'body',
      url: '',
      permalink: '/r/SaaS/t1',
      score: 5,
      numComments: 3,
      createdUtc: 1000,
      stickied: false,
    };
    const exec = makeExecutor({ listing: [post] });
    const runId = await makeRun();
    const discoverTask = await makeTask(runId, 'discover');

    const out = await runStages(exec, 'discover', discoverTask, null);
    expect((out.fetch_listing as DiscoverListingOutput).added).toBe(1);
    expect((out.spawn as DiscoverSpawnOutput).collectSpawned).toBe(1);

    expect(await db.posts.findUnique({ where: { id: 'rd_t1' } })).not.toBeNull();
    const all = await tasks.listByRun(runId);
    expect(all.some((t) => t.kind === 'collect' && t.post_id === 'rd_t1')).toBe(true);
  });

  it('collect：rss 帖 fetch_comments 空评论但 persist 派生 analyze（有 active 模型）', async () => {
    await db.posts.create({
      data: {
        id: 'rss_t1',
        source: 'rss',
        subreddit: 'feed',
        title: 'T',
        created_utc: 1000n,
        fetched_at: 1000n,
        comment_pass: 2,
        analyze_attempts: 0,
      },
    });
    const exec = makeExecutor({ active: { id: 1, model: 'model-x', label: 'x' } });
    const runId = await makeRun();
    const collectTask = await makeTask(runId, 'collect', { postId: 'rss_t1' });
    const post = (await posts.getPostById('rss_t1'))!;

    const out = await runStages(exec, 'collect', collectTask, post);
    expect((out.fetch_comments as FetchCommentsOutput).commentCount).toBe(0); // rss 无评论
    expect((out.persist as CollectPersistOutput).analyzeSpawned).toBe(true);
    const all = await tasks.listByRun(runId);
    expect(all.some((t) => t.kind === 'analyze' && t.post_id === 'rss_t1')).toBe(true);
  });

  it('collect：无 active 模型时不派生 analyze', async () => {
    await db.posts.create({
      data: {
        id: 'rss_t2',
        source: 'rss',
        subreddit: 'feed',
        title: 'T',
        created_utc: 1000n,
        fetched_at: 1000n,
        comment_pass: 2,
        analyze_attempts: 0,
      },
    });
    const exec = makeExecutor({ active: null });
    const runId = await makeRun();
    const collectTask = await makeTask(runId, 'collect', { postId: 'rss_t2' });
    const out = await runStages(exec, 'collect', collectTask, (await posts.getPostById('rss_t2'))!);
    expect((out.persist as CollectPersistOutput).analyzeSpawned).toBe(false);
  });

  it('recheck：评论有变化→重抓 + 派生重新分析 + 退避复位', async () => {
    await db.posts.create({
      data: {
        id: 'rd_r1',
        source: 'reddit',
        subreddit: 'SaaS',
        title: 'T',
        created_utc: 1000n,
        fetched_at: 1000n,
        comment_pass: 2,
        analyze_attempts: 0,
        recheck_misses: 3,
        recheck_due_sweep: 0,
      },
    });
    await db.comments.create({
      data: {
        id: 'c_r1',
        post_id: 'rd_r1',
        body: 'old',
        depth: 0,
        created_utc: 1001n,
        fetched_at: 1001n,
      },
    });
    const exec = makeExecutor({ active: { id: 1, model: 'model-x', label: 'x' } });
    const runId = await makeRun();
    const task = await makeTask(runId, 'recheck', { postId: 'rd_r1', params: { sweep: 5 } });

    // 桩 reddit fetchComments 返回空 → 与「原有 1 条」不一致 → 判定有变化
    const out = await runStages(exec, 'recheck', task, (await posts.getPostById('rd_r1'))!);
    expect((out.persist as RecheckPersistOutput).changed).toBe(true);
    expect((out.persist as RecheckPersistOutput).analyzeSpawned).toBe(true);
    const updated = (await posts.getPostById('rd_r1'))!;
    expect(updated.recheck_misses).toBe(0); // 复位
    expect(updated.recheck_due_sweep).toBe(6); // sweep+1
    expect((await tasks.listByRun(runId)).some((t) => t.kind === 'analyze')).toBe(true);
  });

  it('recheck：评论无变化→指数退避（不派生分析）', async () => {
    await db.posts.create({
      data: {
        id: 'rd_r2',
        source: 'reddit',
        subreddit: 'SaaS',
        title: 'T',
        created_utc: 1000n,
        fetched_at: 1000n,
        comment_pass: 2,
        analyze_attempts: 0,
        recheck_misses: 1,
        recheck_due_sweep: 0,
      },
    });
    const exec = makeExecutor({ active: { id: 1, model: 'model-x', label: 'x' } });
    const runId = await makeRun();
    const task = await makeTask(runId, 'recheck', { postId: 'rd_r2', params: { sweep: 5 } });

    // 无原有评论、桩返回空 → 无变化 → 退避
    const out = await runStages(exec, 'recheck', task, (await posts.getPostById('rd_r2'))!);
    expect((out.persist as RecheckPersistOutput).changed).toBe(false);
    expect((out.persist as RecheckPersistOutput).analyzeSpawned).toBe(false);
    const updated = (await posts.getPostById('rd_r2'))!;
    expect(updated.recheck_misses).toBe(2); // 1+1
    expect(updated.recheck_due_sweep).toBe(7); // sweep 5 + skip(2^1=2)
  });
});
