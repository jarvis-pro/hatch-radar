import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import {
  BlueprintsRepository,
  CommentsRepository,
  InsightsRepository,
  PostsRepository,
  ProcessesRepository,
  ProvidersRepository,
  RunsRepository,
  RuntimeSettingsService,
  SettingsRepository,
  TasksRepository,
  TaskStagesRepository,
} from '@hatch-radar/db';
import { AnalysisService } from '@/lib/analysis';
import type { AnalysisConfigService, PostProcessor, RawModelOutput } from '@/lib/analysis';
import type { TranslationService } from '@/lib/analysis';
import type { Dispatcher } from '@hatch-radar/kernel';
import { nowSec } from '@hatch-radar/kernel';
import {
  INSPECT_STEP_NAMES,
  type AiCallOutput,
  type ContextOutput,
  type FetchOutput,
  type NormalizeOutput,
  type PersistOutput,
  type ResolveOutput,
} from '@hatch-radar/shared';
import { PipelineService } from '@/domain';
// 任务执行内核（WorkerService.runTask）单进程归一后内嵌 api domain；测试直引其源码 + CollectionExecutor 桩。
import { WorkerService } from '../src/domain/worker/worker.service';
import type { CollectionExecutor } from '../src/domain/worker/collection.executor';
import { setupTestDb, truncateAll } from './helpers';

// 桩 AnalysisConfigService 默认返回的原始响应：含一条非法痛点（空 description）以验证归一化丢弃统计。
const RAW: RawModelOutput = {
  raw: JSON.stringify({
    pain_points: [
      { description: '导出功能太难用', evidence: '原文引用', intensity: 'HIGH' },
      { description: '', evidence: '空描述应被丢弃', intensity: 'LOW' },
    ],
    opportunities: [{ title: '一键导出', description: '产品形态', target_user: 'PM' }],
    tags: ['效率工具'],
  }),
  usage: { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 },
  keyId: 7,
  keySwitched: true,
};

/** 桩 AnalysisConfigService：避免真起 AI——resolve 返回固定信息，callRaw 由 {@link callRaw} 注入。 */
function stubConfig(callRaw: () => Promise<RawModelOutput>): AnalysisConfigService {
  const processor: PostProcessor = {
    label: 'Stub (model-x)',
    model: 'model-x',
    analyze: () => Promise.reject(new Error('stub analyze 不应被检视路径调用')),
    callRaw,
  };
  return {
    getProviderInspectInfo: (providerId: number): Promise<ResolveOutput> =>
      Promise.resolve({
        providerId,
        label: 'Stub (model-x)',
        model: 'model-x',
        providerKind: 'anthropic',
        usableKeyCount: 1,
      }),
    getProcessorForProvider: (): Promise<PostProcessor> => Promise.resolve(processor),
  } as unknown as AnalysisConfigService;
}

/**
 * 检视器执行内核闭环（不依赖前端）：检视 = 带闸门的 analyze 任务，验证逐环节暂停—放行—续跑—落库、
 * 运行到底、环节失败重试、取消、paused 不被认领/回收。用桩 AnalysisConfigService 隔离真实 AI，
 * 其余仓储/落库均真连 PG。复用 tasks/task_stages 同一执行内核（取代旧 analysis_jobs 检视专路）。
 */
describe('流水线检视器：执行内核（runTask 闸门状态机）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let tasks: TasksRepository;
  let taskStages: TaskStagesRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    tasks = new TasksRepository(db);
    taskStages = new TaskStagesRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  /** 种子帖子（含 2 条评论，含一层回复）。 */
  async function seedPost(id = 'p1'): Promise<void> {
    await db.posts.create({
      data: {
        id,
        subreddit: 'SaaS',
        title: 'Looking for a tool',
        selftext: '正文内容',
        created_utc: 1000n,
        fetched_at: 1000n,
        comment_pass: 1,
        analyze_attempts: 0,
      },
    });
    await db.comments.createMany({
      data: [
        {
          id: 'c1',
          post_id: id,
          body: '顶层评论',
          depth: 0,
          created_utc: 1001n,
          fetched_at: 1001n,
        },
        {
          id: 'c2',
          post_id: id,
          parent_id: 'c1',
          body: '回复',
          depth: 1,
          created_utc: 1002n,
          fetched_at: 1002n,
        },
      ],
    });
  }

  /** 建一张 analyze 图纸 + 一个 analyze 进程（任务的归属，满足 run_id 外键）。 */
  async function seedRun(): Promise<number> {
    const bp = await new BlueprintsRepository(db).createBlueprint(
      { kind: 'analyze', label: '检视' },
      nowSec(),
    );
    const run = await new RunsRepository(db).createRun(
      { blueprintId: bp.id, kind: 'analyze', triggerSource: 'inspect' },
      nowSec(),
    );
    return run.id;
  }

  /** 派生一个检视用 analyze 任务（6 环节，stepGate 时每环节挂闸门）。 */
  async function seedTask(stepGate: boolean, runId: number): Promise<number> {
    const stages = INSPECT_STEP_NAMES.map((name) => ({ name, gate: stepGate }));
    const res = await tasks.createTaskWithStages(
      { runId, kind: 'analyze', postId: 'p1', providerId: 1, model: 'model-x' },
      stages,
      nowSec(),
    );
    if (!res.ok) throw new Error(res.error);
    return res.taskId;
  }

  /** 用桩 config 构造 WorkerService（其余仓储真连 db）。 */
  function makeWorker(callRaw: () => Promise<RawModelOutput>): WorkerService {
    const settings = new SettingsRepository(db);
    return new WorkerService(
      tasks,
      taskStages,
      new RunsRepository(db),
      new PostsRepository(db),
      new CommentsRepository(db),
      new AnalysisService(new InsightsRepository(db)),
      stubConfig(callRaw),
      {} as unknown as TranslationService,
      new RuntimeSettingsService(settings),
      {} as unknown as CollectionExecutor,
    );
  }

  /** 模拟「网关认领 + 分发」一次：claim（queued→running）→ 交 worker 执行。 */
  async function claimAndRun(worker: WorkerService): Promise<void> {
    const task = await tasks.claimNextTask(nowSec());
    expect(task).not.toBeNull();
    await worker.executeDispatchedTask(task!.id);
  }

  it('建任务：queued + 6 个 pending 环节，stepGate 时每环节挂闸门', async () => {
    await seedPost();
    const runId = await seedRun();
    const taskId = await seedTask(true, runId);
    expect(await tasks.getTask(taskId)).toMatchObject({ kind: 'analyze', status: 'queued' });
    const stages = await taskStages.listStages(taskId);
    expect(stages.map((s) => s.name)).toEqual([...INSPECT_STEP_NAMES]);
    expect(stages.every((s) => s.status === 'pending')).toBe(true);
    expect(stages.every((s) => s.gate)).toBe(true);
  });

  it('同帖已有活跃 analyze 任务时再建被去重拒绝', async () => {
    await seedPost();
    const runId = await seedRun();
    await seedTask(false, runId);
    const res = await tasks.createTaskWithStages(
      { runId, kind: 'analyze', postId: 'p1', providerId: 1, model: 'model-x' },
      INSPECT_STEP_NAMES.map((name) => ({ name })),
      nowSec(),
    );
    expect(res.ok).toBe(false);
  });

  it('逐环节：每环节一停—放行—续跑，末环节落库并整条成功；产物与丢弃统计正确', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const runId = await seedRun();
    const taskId = await seedTask(true, runId);

    // 环节 0..4：每次认领跑一个环节后置 paused；paused 不被再次认领；放行进入下一环节
    for (let i = 0; i < 5; i++) {
      await claimAndRun(worker);
      expect((await tasks.getTask(taskId))!.status).toBe('paused');
      const stages = await taskStages.listStages(taskId);
      expect(stages[i]!.status).toBe('done');
      expect(stages[i + 1]!.status).toBe('pending');
      expect(await tasks.claimNextTask(nowSec())).toBeNull(); // paused 天然被「只认领 queued」排除
      expect(await tasks.resumeTask(taskId)).toBe(true);
    }

    // 环节 5 persist：认领跑完 → succeeded，usage 从 ai_call 环节回填
    await claimAndRun(worker);
    const task = await tasks.getTask(taskId);
    expect(task!.status).toBe('succeeded');
    expect(task!.input_tokens).toBe(100);

    const stages = await taskStages.listStages(taskId);
    expect(stages.every((s) => s.status === 'done')).toBe(true);
    const out = Object.fromEntries(stages.map((s) => [s.name, s.output])) as Record<
      string,
      unknown
    >;
    expect((out.resolve as ResolveOutput).model).toBe('model-x');
    expect((out.fetch as FetchOutput).commentCount).toBe(2);
    expect((out.fetch as FetchOutput).maxDepth).toBe(1);
    expect((out.context as ContextOutput).contextText).toContain('Looking for a tool');
    expect((out.ai_call as AiCallOutput).keyId).toBe(7);
    expect((out.ai_call as AiCallOutput).keySwitched).toBe(true);
    expect((out.normalize as NormalizeOutput).insight.pain_points).toHaveLength(1);
    expect((out.normalize as NormalizeOutput).droppedPainPoints).toBe(1);
    expect((out.persist as PersistOutput).saved).toBe(true);

    // 洞察已落库（按 post_id 幂等）+ 帖子已标记分析
    expect(await db.insights.findUnique({ where: { post_id: 'p1' } })).not.toBeNull();
    expect((await db.posts.findUnique({ where: { id: 'p1' } }))!.analyzed_at).not.toBeNull();
  });

  it('运行到底（无闸门）：一次认领连续跑完所有环节并成功', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const runId = await seedRun();
    const taskId = await seedTask(false, runId);
    await claimAndRun(worker);
    expect((await tasks.getTask(taskId))!.status).toBe('succeeded');
    const stages = await taskStages.listStages(taskId);
    expect(stages.every((s) => s.status === 'done')).toBe(true);
    expect(await db.insights.findUnique({ where: { post_id: 'p1' } })).not.toBeNull();
  });

  it('环节失败 → 环节+任务置 failed、前序检查点保留；retry（复位环节+重排）后从该环节续跑成功', async () => {
    await seedPost();
    let attempt = 0;
    // 第 1 次 callRaw（ai_call）失败，第 2 次成功——验证「重认领只重调 ai_call、上游不重跑」
    const worker = makeWorker(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('限流 boom')) : Promise.resolve(RAW);
    });
    const runId = await seedRun();
    const taskId = await seedTask(false, runId);

    await claimAndRun(worker); // 运行到底，在 ai_call 失败
    expect((await tasks.getTask(taskId))!.status).toBe('failed');
    let stages = await taskStages.listStages(taskId);
    expect(stages.find((s) => s.name === 'ai_call')!.status).toBe('failed');
    expect(stages.find((s) => s.name === 'context')!.status).toBe('done'); // 上游检查点保留
    expect(stages.find((s) => s.name === 'normalize')!.status).toBe('pending');

    // 重试：复位失败环节 + 整条任务 failed→queued
    const aiSeq = stages.find((s) => s.name === 'ai_call')!.seq;
    await taskStages.resetStageToPending(taskId, aiSeq);
    expect(await tasks.requeueFailedTask(taskId)).toBe(true);

    await claimAndRun(worker); // 从 ai_call 重跑（第 2 次成功）→ 完成
    expect((await tasks.getTask(taskId))!.status).toBe('succeeded');
    stages = await taskStages.listStages(taskId);
    expect(stages.every((s) => s.status === 'done')).toBe(true);
    expect(attempt).toBe(2); // ai_call 恰好被调用两次（失败 1 + 成功 1），上游未重调
    expect(await db.insights.findUnique({ where: { post_id: 'p1' } })).not.toBeNull();
  });

  it('取消暂停中的任务 → canceled，且不再被认领；僵死回收不动 paused', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const runId = await seedRun();
    const taskId = await seedTask(true, runId);

    await claimAndRun(worker); // 跑 resolve 后 paused
    expect((await tasks.getTask(taskId))!.status).toBe('paused');

    // 僵死回收只扫 running：paused 不被回收
    expect(await tasks.reclaimRunningTasks(nowSec() + 10_000, null)).toBe(0);
    expect((await tasks.getTask(taskId))!.status).toBe('paused');

    // 取消 → canceled，不再被认领
    expect(await tasks.cancelTask(taskId, nowSec())).toBe(true);
    expect((await tasks.getTask(taskId))!.status).toBe('canceled');
    expect(await tasks.claimNextTask(nowSec())).toBeNull();
  });
});

/**
 * 检视器 API 编排（PipelineService）：发起 / 视图组装 / 放行·运行到底·重试·取消的状态流转与派发触发。
 * 用计数 Dispatcher 验证「写操作后触发一次派发」，其余仓储真连 PG（取代旧 AnalysisConfigService 编排）。
 */
describe('流水线检视器：PipelineService 编排（API 层）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let tasks: TasksRepository;
  let taskStages: TaskStagesRepository;
  let svc: PipelineService;
  let dispatchCount = 0;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    tasks = new TasksRepository(db);
    taskStages = new TaskStagesRepository(db);
    const gateway: Dispatcher = {
      tryDispatch: () => {
        dispatchCount += 1;
        return Promise.resolve();
      },
    };
    svc = new PipelineService(
      new BlueprintsRepository(db),
      new RunsRepository(db),
      tasks,
      taskStages,
      new PostsRepository(db),
      {} as unknown as AnalysisConfigService,
      {} as unknown as RuntimeSettingsService,
      new ProvidersRepository(db),
      new ProcessesRepository(db),
      gateway,
    );
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    dispatchCount = 0;
  });

  async function seedPost(id = 'p1'): Promise<void> {
    await db.posts.create({
      data: {
        id,
        subreddit: 'SaaS',
        title: 'T',
        created_utc: 1000n,
        fetched_at: 1000n,
        comment_pass: 1,
        analyze_attempts: 0,
      },
    });
  }

  async function seedProvider(): Promise<number> {
    const p = await db.model_providers.create({
      data: {
        provider: 'anthropic',
        label: 'Claude',
        model: 'claude-x',
        enabled: true,
        input_price: null,
        output_price: null,
        created_at: 0n,
        updated_at: 0n,
      },
    });
    return p.id;
  }

  it('enqueueInspect：校验模型 → 建 analyze 任务 + 6 环节（挂闸门）→ 触发派发', async () => {
    await seedPost();
    const providerId = await seedProvider();
    const res = await svc.enqueueInspect('p1', providerId, true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(dispatchCount).toBe(1);
    const view = await svc.getInspectView(res.taskId);
    expect(view).not.toBeNull();
    expect(view!.status).toBe('queued');
    expect(view!.stepGate).toBe(true);
    expect(view!.provider).toBe('anthropic');
    expect(view!.steps).toHaveLength(6);
    expect(view!.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('enqueueInspect：模型不存在 → ok=false 且不派发', async () => {
    await seedPost();
    const res = await svc.enqueueInspect('p1', 9999, true);
    expect(res.ok).toBe(false);
    expect(dispatchCount).toBe(0);
  });

  it('getInspectView：不存在的任务返回 null', async () => {
    expect(await svc.getInspectView(999999)).toBeNull();
  });

  it('resumeInspect / cancelInspect：经服务流转状态并触发派发', async () => {
    await seedPost();
    const providerId = await seedProvider();
    const res = await svc.enqueueInspect('p1', providerId, true);
    if (!res.ok) throw new Error('创建失败');
    await tasks.claimNextTask(nowSec()); // →running
    await tasks.pauseTask(res.taskId); // →paused
    dispatchCount = 0;

    expect(await svc.resumeInspect(res.taskId)).toBe(true);
    expect(dispatchCount).toBe(1);
    expect((await tasks.getTask(res.taskId))!.status).toBe('queued');

    expect(await svc.cancelInspect(res.taskId)).toBe(true);
    expect((await tasks.getTask(res.taskId))!.status).toBe('canceled');
  });

  it('runInspectToEnd：清除全部环节闸门并放行（暂停→queued）', async () => {
    await seedPost();
    const providerId = await seedProvider();
    const res = await svc.enqueueInspect('p1', providerId, true);
    if (!res.ok) throw new Error('创建失败');
    await tasks.claimNextTask(nowSec()); // →running
    await tasks.pauseTask(res.taskId); // →paused
    dispatchCount = 0;

    await svc.runInspectToEnd(res.taskId);
    expect(dispatchCount).toBe(1);
    expect((await tasks.getTask(res.taskId))!.status).toBe('queued');
    const stages = await taskStages.listStages(res.taskId);
    expect(stages.every((s) => !s.gate)).toBe(true);
  });

  it('retryInspectStep：失败任务复位失败环节 + 重排 queued + 派发', async () => {
    await seedPost();
    const providerId = await seedProvider();
    const res = await svc.enqueueInspect('p1', providerId, false);
    if (!res.ok) throw new Error('创建失败');
    const taskId = res.taskId;
    await tasks.claimNextTask(nowSec()); // →running
    await tasks.setCurrentSeq(taskId, 3); // 当前停在 ai_call
    await taskStages.markStageFailed(taskId, 3, 'boom', nowSec());
    await tasks.failTask(taskId, 'boom', nowSec());
    dispatchCount = 0;

    const r = await svc.retryInspectStep(taskId);
    expect(r.ok).toBe(true);
    expect(dispatchCount).toBe(1);
    expect((await tasks.getTask(taskId))!.status).toBe('queued');
    const stages = await taskStages.listStages(taskId);
    expect(stages.find((s) => s.seq === 3)!.status).toBe('pending');
  });
});
