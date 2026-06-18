import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import {
  CommentsRepository,
  InsightsRepository,
  JobsRepository,
  JobStepsRepository,
  PostsRepository,
  ProvidersRepository,
  RuntimeSettingsService,
  SettingsRepository,
} from '@hatch-radar/db';
import { AnalysisConfigService, AnalysisService } from '@hatch-radar/analysis';
import type { PostProcessor, RawModelOutput } from '@hatch-radar/analysis';
import type { TranslationService } from '@hatch-radar/analysis';
import type { Dispatcher } from '@hatch-radar/kernel';
import {
  INSPECT_STEP_NAMES,
  type AiCallOutput,
  type ContextOutput,
  type FetchOutput,
  type NormalizeOutput,
  type PersistOutput,
  type ResolveOutput,
} from '@hatch-radar/shared';
import { nowSec } from '@hatch-radar/kernel';
// 跨 app 引 worker 数据面执行器：检视内核（runInspectJob）只有 worker 进程承载，而集成测试的 PG
// 夹具在 apps/api/test，故以相对路径直引其源码（vitest 内联编译 @hatch-radar/* 依赖）。
import { WorkerService } from '../../worker/src/worker.service';
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
 * 检视器执行内核闭环测试（不依赖前端）：逐节点暂停—放行—续跑—落库、运行到底、节点失败重试、取消、
 * paused 不被认领/回收。用桩 AnalysisConfigService 隔离真实 AI 调用，其余仓储/落库均真连 PG。
 */
describe('流水线检视器：执行内核（runInspectJob + 状态机）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let jobs: JobsRepository;
  let jobSteps: JobStepsRepository;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    jobs = new JobsRepository(db);
    jobSteps = new JobStepsRepository(db);
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

  /** 用桩 config 构造 WorkerService（其余仓储真连 db）。 */
  function makeWorker(callRaw: () => Promise<RawModelOutput>): WorkerService {
    const settings = new SettingsRepository(db);
    return new WorkerService(
      jobs,
      jobSteps,
      new PostsRepository(db),
      new CommentsRepository(db),
      new AnalysisService(new InsightsRepository(db)),
      stubConfig(callRaw),
      {} as unknown as TranslationService,
      new RuntimeSettingsService(settings),
    );
  }

  /** 模拟「网关认领 + 分发」一次：claim（queued→running）→ 交 worker 执行。 */
  async function claimAndRun(worker: WorkerService): Promise<void> {
    const job = await jobs.claimNextJob(nowSec());
    expect(job).not.toBeNull();
    await worker.executeDispatchedJob({
      id: job!.id,
      post_id: job!.post_id,
      provider_id: job!.provider_id,
    });
  }

  it('createInspectJob 建 queued/inspect/manual 任务 + 6 个 pending 节点', async () => {
    await seedPost();
    const res = await jobs.createInspectJob('p1', 1, 'model-x', true, INSPECT_STEP_NAMES, nowSec());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const job = await jobs.getJob(res.jobId);
    expect(job).toMatchObject({
      inspect: true,
      step_gate: true,
      status: 'queued',
      trigger: 'manual',
    });
    const steps = await jobSteps.listSteps(res.jobId);
    expect(steps.map((s) => s.name)).toEqual([...INSPECT_STEP_NAMES]);
    expect(steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('同帖已有活跃分析任务时 createInspectJob 拒绝', async () => {
    await seedPost();
    await jobs.enqueueJobs(['p1'], 1, 'model-x', 'auto', nowSec()); // 已有 queued 分析任务
    const res = await jobs.createInspectJob('p1', 1, 'model-x', true, INSPECT_STEP_NAMES, nowSec());
    expect(res.ok).toBe(false);
  });

  it('逐节点：每节点一停—放行—续跑，末节点落库并整条成功；产物与丢弃统计正确', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const created = await jobs.createInspectJob(
      'p1',
      1,
      'model-x',
      true,
      INSPECT_STEP_NAMES,
      nowSec(),
    );
    if (!created.ok) throw new Error('创建失败');
    const jobId = created.jobId;

    // 节点 0..4：每次认领跑一个节点后置 paused；paused 不被再次认领；放行进入下一节点
    for (let i = 0; i < 5; i++) {
      await claimAndRun(worker);
      expect((await jobs.getJob(jobId))!.status).toBe('paused');
      const steps = await jobSteps.listSteps(jobId);
      expect(steps[i]!.status).toBe('done');
      expect(steps[i + 1]!.status).toBe('pending');
      expect(await jobs.claimNextJob(nowSec())).toBeNull(); // paused 天然被「只认领 queued」排除
      expect(await jobs.resumeInspectJob(jobId)).toBe(true);
    }

    // 节点 5 persist：认领跑完 → succeeded，usage 从 ai_call 节点回填
    await claimAndRun(worker);
    const job = await jobs.getJob(jobId);
    expect(job!.status).toBe('succeeded');
    expect(job!.input_tokens).toBe(100);

    const steps = await jobSteps.listSteps(jobId);
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    const out = Object.fromEntries(steps.map((s) => [s.name, s.output])) as Record<string, unknown>;
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

  it('运行到底（step_gate=false）：一次认领连续跑完所有节点并成功', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const created = await jobs.createInspectJob(
      'p1',
      1,
      'model-x',
      false,
      INSPECT_STEP_NAMES,
      nowSec(),
    );
    if (!created.ok) throw new Error('创建失败');
    await claimAndRun(worker);
    expect((await jobs.getJob(created.jobId))!.status).toBe('succeeded');
    const steps = await jobSteps.listSteps(created.jobId);
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    expect(await db.insights.findUnique({ where: { post_id: 'p1' } })).not.toBeNull();
  });

  it('节点失败 → step+job 置 failed、前序检查点保留；retry（复位 step + 重排）后从该节点续跑成功', async () => {
    await seedPost();
    let attempt = 0;
    // 第 1 次 callRaw（ai_call）失败，第 2 次成功——验证「重认领只重调 ai_call、上游不重跑」
    const worker = makeWorker(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('限流 boom')) : Promise.resolve(RAW);
    });
    const created = await jobs.createInspectJob(
      'p1',
      1,
      'model-x',
      false,
      INSPECT_STEP_NAMES,
      nowSec(),
    );
    if (!created.ok) throw new Error('创建失败');
    const jobId = created.jobId;

    await claimAndRun(worker); // 运行到底，在 ai_call 失败
    expect((await jobs.getJob(jobId))!.status).toBe('failed');
    let steps = await jobSteps.listSteps(jobId);
    expect(steps.find((s) => s.name === 'ai_call')!.status).toBe('failed');
    expect(steps.find((s) => s.name === 'context')!.status).toBe('done'); // 上游检查点保留
    expect(steps.find((s) => s.name === 'normalize')!.status).toBe('pending');

    // 重试：复位失败节点 + 整条 job failed→queued
    const aiSeq = steps.find((s) => s.name === 'ai_call')!.seq;
    await jobSteps.resetStepToPending(jobId, aiSeq);
    expect(await jobs.requeueFailedJob(jobId)).toBe(true);

    await claimAndRun(worker); // 从 ai_call 重跑（第 2 次成功）→ 完成
    expect((await jobs.getJob(jobId))!.status).toBe('succeeded');
    steps = await jobSteps.listSteps(jobId);
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    expect(attempt).toBe(2); // ai_call 恰好被调用两次（失败 1 + 成功 1），上游未重调
    expect(await db.insights.findUnique({ where: { post_id: 'p1' } })).not.toBeNull();
  });

  it('取消暂停中的检视任务 → canceled，且不再被认领；僵死回收不动 paused', async () => {
    await seedPost();
    const worker = makeWorker(() => Promise.resolve(RAW));
    const created = await jobs.createInspectJob(
      'p1',
      1,
      'model-x',
      true,
      INSPECT_STEP_NAMES,
      nowSec(),
    );
    if (!created.ok) throw new Error('创建失败');
    const jobId = created.jobId;

    await claimAndRun(worker); // 跑 resolve 后 paused
    expect((await jobs.getJob(jobId))!.status).toBe('paused');

    // 僵死回收只扫 running：paused 不被回收
    expect(await jobs.reclaimRunningJobs(nowSec() + 10_000, null)).toBe(0);
    expect((await jobs.getJob(jobId))!.status).toBe('paused');

    // 取消 → canceled，不再被认领
    expect(await jobs.cancelJob(jobId, nowSec())).toBe(true);
    expect((await jobs.getJob(jobId))!.status).toBe('canceled');
    expect(await jobs.claimNextJob(nowSec())).toBeNull();
  });
});

/**
 * 检视器 API 编排（AnalysisConfigService）：发起 / 视图组装 / 放行·运行到底·重试·取消的状态流转
 * 与派发触发。用计数 Dispatcher 验证「写操作后触发一次派发」，其余仓储真连 PG。
 */
describe('流水线检视器：AnalysisConfigService 编排（API 层）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let jobs: JobsRepository;
  let jobSteps: JobStepsRepository;
  let svc: AnalysisConfigService;
  let dispatchCount = 0;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    jobs = new JobsRepository(db);
    jobSteps = new JobStepsRepository(db);
    const gateway: Dispatcher = {
      tryDispatch: () => {
        dispatchCount += 1;
        return Promise.resolve();
      },
    };
    svc = new AnalysisConfigService(
      new ProvidersRepository(db),
      new SettingsRepository(db),
      jobs,
      jobSteps,
      new PostsRepository(db),
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

  it('enqueueInspectRun：校验模型 → 建 inspect job + 6 节点 → 触发派发', async () => {
    await seedPost();
    const providerId = await seedProvider();
    const res = await svc.enqueueInspectRun('p1', providerId, true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(dispatchCount).toBe(1);
    const view = await svc.getInspectView(res.jobId);
    expect(view).not.toBeNull();
    expect(view!.status).toBe('queued');
    expect(view!.stepGate).toBe(true);
    expect(view!.provider).toBe('anthropic');
    expect(view!.steps).toHaveLength(6);
    expect(view!.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('enqueueInspectRun：模型不存在 → ok=false 且不派发', async () => {
    await seedPost();
    const res = await svc.enqueueInspectRun('p1', 9999, true);
    expect(res.ok).toBe(false);
    expect(dispatchCount).toBe(0);
  });

  it('getInspectView：普通（非检视）任务返回 null', async () => {
    await seedPost();
    await jobs.enqueueJobs(['p1'], 1, 'm', 'auto', nowSec());
    const job = await db.analysis_jobs.findFirst({ where: { post_id: 'p1' } });
    expect(await svc.getInspectView(job!.id)).toBeNull();
  });

  it('resumeInspect / cancelInspect：经服务流转状态并触发派发', async () => {
    await seedPost();
    const providerId = await seedProvider();
    const res = await svc.enqueueInspectRun('p1', providerId, true);
    if (!res.ok) throw new Error('创建失败');
    await jobs.claimNextJob(nowSec()); // →running
    await jobs.pauseJob(res.jobId); // →paused
    dispatchCount = 0;

    expect(await svc.resumeInspect(res.jobId)).toBe(true);
    expect(dispatchCount).toBe(1);
    expect((await jobs.getJob(res.jobId))!.status).toBe('queued');

    expect(await svc.cancelInspect(res.jobId)).toBe(true);
    expect((await jobs.getJob(res.jobId))!.status).toBe('canceled');
  });

  it('retryInspectStep：失败任务复位失败节点 + 重排 queued + 派发', async () => {
    await seedPost();
    const providerId = await seedProvider();
    const res = await svc.enqueueInspectRun('p1', providerId, false);
    if (!res.ok) throw new Error('创建失败');
    const jobId = res.jobId;
    await jobs.claimNextJob(nowSec()); // →running
    await jobSteps.markStepFailed(jobId, 3, 'boom', nowSec()); // ai_call 失败
    await jobs.failJob(jobId, 'boom', nowSec());
    dispatchCount = 0;

    const r = await svc.retryInspectStep(jobId);
    expect(r.ok).toBe(true);
    expect(dispatchCount).toBe(1);
    expect((await jobs.getJob(jobId))!.status).toBe('queued');
    const steps = await jobSteps.listSteps(jobId);
    expect(steps.find((s) => s.seq === 3)!.status).toBe('pending');
  });
});
