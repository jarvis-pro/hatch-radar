import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@/database';
import {
  BlueprintsRepository,
  CommentsRepository,
  CostRepository,
  InsightsRepository,
  PostsRepository,
  RunsRepository,
  SettingsRepository,
  TasksRepository,
  TaskStagesRepository,
} from '@/database';
import { RuntimeSettingsService } from '@/modules/settings/settings.runtime-settings.service';
import type { PostProcessor, RawModelOutput } from '@/analysis';
import { AnalysisConfigService } from '@/modules/analysis/analysis-config.service';
import { AnalysisService } from '@/modules/analysis/analysis.service';
import type { TranslationService } from '@/modules/analysis/translation.service';
import { INSPECT_STEP_NAMES, type PersistOutput, type ResolveOutput } from '@hatch-radar/shared';
import { nowSec } from '@/utils/time';
// 通用任务内核（WorkerService.runTask）单进程归一后内嵌 api domain；测试直引其源码 + AnalyzeExecutor / CollectionExecutor 桩。
import { WorkerService } from '@/modules/worker/worker.service';
import { AnalyzeExecutor } from '@/modules/worker/internal/analyze.executor';
import type { CollectionExecutor } from '@/modules/worker/internal/collection.executor';
import { setupTestDb, truncateAll } from './helpers';

// 桩原始响应：含一条非法痛点（空 description）验证归一化丢弃；与 inspect 套件同构。
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

/** 桩 AnalysisConfigService：避免真起 AI——resolve 返回固定信息，callRaw 由参数注入。 */
function stubConfig(callRaw: () => Promise<RawModelOutput>): AnalysisConfigService {
  const processor: PostProcessor = {
    label: 'Stub (model-x)',
    model: 'model-x',
    analyze: () => Promise.reject(new Error('stub analyze 不应被任务内核调用')),
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
 * 图纸生命周期通用任务执行内核闭环测试（不依赖前端）：analyze 任务走 blueprints→runs→tasks→task_stages，
 * 验证逐环节闸门—放行—续跑—落库、运行到底、环节失败复位重排续跑、同帖去重、取消、僵死回收不动 paused、
 * run 计数。用桩 AnalysisConfigService 隔离真实 AI，其余仓储/落库真连 PG。
 */
describe('图纸生命周期：通用任务执行内核（runTask + task_stages 闸门）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let tasks: TasksRepository;
  let taskStages: TaskStagesRepository;
  let runs: RunsRepository;
  let blueprints: BlueprintsRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    tasks = new TasksRepository(db);
    taskStages = new TaskStagesRepository(db);
    runs = new RunsRepository(db);
    blueprints = new BlueprintsRepository(db);
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

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

  function makeWorker(
    callRaw: () => Promise<RawModelOutput>,
    translation: TranslationService = {} as unknown as TranslationService,
  ): WorkerService {
    const analyze = new AnalyzeExecutor(
      stubConfig(callRaw),
      new AnalysisService(new InsightsRepository(db)),
      new CommentsRepository(db),
      new PostsRepository(db),
    );

    return new WorkerService(
      tasks,
      taskStages,
      runs,
      new PostsRepository(db),
      translation,
      new RuntimeSettingsService(new SettingsRepository(db)),
      {} as unknown as CollectionExecutor,
      analyze,
    );
  }

  /** 建一条 analyze 图纸 + 进程 + 任务（6 个 analyze 环节，gate 由参数指定）。 */
  async function createAnalyzeTask(gate: boolean): Promise<{ runId: number; taskId: number }> {
    const bp = await blueprints.createBlueprint({ kind: 'analyze', label: 'A' }, nowSec());
    const run = await runs.createRun(
      { blueprintId: bp.id, kind: 'analyze', triggerSource: 'manual' },
      nowSec(),
    );
    const res = await tasks.createTaskWithStages(
      { runId: run.id, kind: 'analyze', postId: 'p1', providerId: 1, model: 'model-x' },
      INSPECT_STEP_NAMES.map((name) => ({ name, gate })),
      nowSec(),
    );
    if (!res.ok) {
      throw new Error(res.error);
    }

    return { runId: run.id, taskId: res.taskId };
  }

  /** 模拟「认领 + 分发」一次：claim（queued→running）→ 交 worker 执行。 */
  async function claimAndRun(worker: WorkerService): Promise<void> {
    const t = await tasks.claimNextTask(nowSec());
    expect(t).not.toBeNull();
    await worker.executeDispatchedTask(t!.id);
  }

  it('逐环节闸门：每环节一停—放行—续跑，末环节落库并整条成功 + run 计数', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const { runId, taskId } = await createAnalyzeTask(true);

    // 环节 0..4：每次认领跑一个环节后置 paused；paused 不被再次认领；放行进入下一环节
    for (let i = 0; i < 5; i++) {
      await claimAndRun(worker);
      expect((await tasks.getTask(taskId))!.status).toBe('paused');
      const stages = await taskStages.listStages(taskId);
      expect(stages[i]!.status).toBe('done');
      expect(stages[i + 1]!.status).toBe('pending');
      expect(await tasks.claimNextTask(nowSec())).toBeNull(); // paused 被「只认领 queued」排除
      expect(await tasks.resumeTask(taskId)).toBe(true);
    }

    // 末环节 persist：认领跑完 → succeeded，usage 从 ai_call 环节回填
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
    expect((out.persist as PersistOutput).saved).toBe(true);

    // 洞察已落库（按 post_id 幂等）+ 帖子已标记分析 + run 计数 +1
    expect(await db.insights.findUnique({ where: { post_id: 'p1' } })).not.toBeNull();
    expect((await db.posts.findUnique({ where: { id: 'p1' } }))!.analyzed_at).not.toBeNull();
    expect((await runs.getRun(runId))!.tasks_done).toBe(1);

    // 成本看板：成功的 analyze 任务计入 getCostStats（dashboard 成本现自 tasks 派生）
    const costRepo = new CostRepository(db);
    const cost = await costRepo.getCostStats(0);
    expect(cost.totals.inputTokens).toBe(100);
    expect(cost.byModel.find((m) => m.model === 'model-x')?.jobs).toBe(1);
    // getThroughput 须能执行（曾因 status 枚举 vs text 类型不匹配报 42804；现 tasks.status 为 text）且计入该任务
    const throughput = await costRepo.getThroughput(7);
    expect(throughput).toHaveLength(7);
    expect(throughput.reduce((sum, p) => sum + p.succeeded, 0)).toBeGreaterThanOrEqual(1);
  });

  it('运行到底（无闸门）：一次认领连续跑完所有环节并成功', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const { taskId } = await createAnalyzeTask(false);
    await claimAndRun(worker);
    expect((await tasks.getTask(taskId))!.status).toBe('succeeded');
    expect((await taskStages.listStages(taskId)).every((s) => s.status === 'done')).toBe(true);
    expect(await db.insights.findUnique({ where: { post_id: 'p1' } })).not.toBeNull();
  });

  it('环节失败 → task+stage failed、前序检查点保留；复位+重排后从该环节续跑成功（ai_call 只调两次）', async () => {
    await seedPost();
    let attempt = 0;
    const worker = makeWorker(() => {
      attempt += 1;

      return attempt === 1 ? Promise.reject(new Error('限流 boom')) : Promise.resolve(RAW);
    });
    const { taskId } = await createAnalyzeTask(false);

    await claimAndRun(worker); // 运行到底，在 ai_call 失败
    expect((await tasks.getTask(taskId))!.status).toBe('failed');
    let stages = await taskStages.listStages(taskId);
    expect(stages.find((s) => s.name === 'ai_call')!.status).toBe('failed');
    expect(stages.find((s) => s.name === 'context')!.status).toBe('done'); // 上游检查点保留
    expect(stages.find((s) => s.name === 'normalize')!.status).toBe('pending');

    const aiSeq = stages.find((s) => s.name === 'ai_call')!.seq;
    await taskStages.resetStageToPending(taskId, aiSeq);
    expect(await tasks.requeueFailedTask(taskId)).toBe(true);

    await claimAndRun(worker); // 从 ai_call 重跑（第 2 次成功）→ 完成
    expect((await tasks.getTask(taskId))!.status).toBe('succeeded');
    stages = await taskStages.listStages(taskId);
    expect(stages.every((s) => s.status === 'done')).toBe(true);
    expect(attempt).toBe(2); // ai_call 恰好被调用两次，上游未重调
    expect(await db.insights.findUnique({ where: { post_id: 'p1' } })).not.toBeNull();
  });

  it('同帖同 kind 去重：已有活跃任务时 createTaskWithStages 拒绝', async () => {
    await seedPost();
    await createAnalyzeTask(false); // 已有活跃 queued analyze 任务
    const bp = await blueprints.createBlueprint({ kind: 'analyze', label: 'A2' }, nowSec());
    const run = await runs.createRun(
      { blueprintId: bp.id, kind: 'analyze', triggerSource: 'manual' },
      nowSec(),
    );
    const res = await tasks.createTaskWithStages(
      { runId: run.id, kind: 'analyze', postId: 'p1', providerId: 1, model: 'model-x' },
      INSPECT_STEP_NAMES.map((name) => ({ name })),
      nowSec(),
    );
    expect(res.ok).toBe(false);
  });

  it('取消 paused 任务 → canceled 不再被认领；僵死回收不动 paused', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const { taskId } = await createAnalyzeTask(true);

    await claimAndRun(worker); // 跑 resolve 后 paused
    expect((await tasks.getTask(taskId))!.status).toBe('paused');

    // 僵死回收只扫 running：paused 不被回收
    expect(await tasks.reclaimRunningTasks(nowSec() + 10_000, null)).toBe(0);
    expect((await tasks.getTask(taskId))!.status).toBe('paused');

    expect(await tasks.cancelTask(taskId, nowSec())).toBe(true);
    expect((await tasks.getTask(taskId))!.status).toBe('canceled');
    expect(await tasks.claimNextTask(nowSec())).toBeNull();
  });

  it('translate 任务：执行翻译并把 usage 回填到任务（成本聚合用）', async () => {
    await db.posts.create({
      data: {
        id: 'rd_tr1',
        source: 'reddit',
        subreddit: 'SaaS',
        title: 'T',
        created_utc: 1000n,
        fetched_at: 1000n,
        comment_pass: 2,
        analyze_attempts: 0,
      },
    });
    const translation = {
      translatePost: () =>
        Promise.resolve({
          translated: 2,
          skipped: 0,
          usage: { inputTokens: 30, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    } as unknown as TranslationService;
    const worker = makeWorker(() => Promise.resolve(RAW), translation);

    const bp = await blueprints.createBlueprint({ kind: 'translate', label: '翻译' }, nowSec());
    const run = await runs.createRun(
      { blueprintId: bp.id, kind: 'translate', triggerSource: 'manual' },
      nowSec(),
    );
    const res = await tasks.createTaskWithStages(
      { runId: run.id, kind: 'translate', postId: 'rd_tr1', providerId: 1, model: 'azure-x' },
      [{ name: 'translate' }],
      nowSec(),
    );
    if (!res.ok) {
      throw new Error(res.error);
    }

    const t = await tasks.claimNextTask(nowSec());
    expect(t).not.toBeNull();
    await worker.executeDispatchedTask(t!.id);

    const task = await tasks.getTask(res.taskId);
    expect(task!.status).toBe('succeeded');
    expect(task!.input_tokens).toBe(30); // usage 经 usageFromSteps('translate') 回填
  });
});
