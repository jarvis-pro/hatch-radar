import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@hatch-radar/db';
import {
  BlueprintsRepository,
  ProcessesRepository,
  RequestLanesRepository,
  RequestQueueRepository,
  RunsRepository,
  TaskStagesRepository,
  TasksRepository,
} from '@hatch-radar/db';
import { buildStages } from '@hatch-radar/shared';
import { nowSec } from '@hatch-radar/kernel';
import { RadarService, type GatewayService, type PipelineService } from '@/domain';
import { setupTestDb, truncateAll } from './helpers';

/**
 * 雷达指挥室读 / 聚合 / CRUD 服务（真连 PG，验证查询能跑通、DTO 形状正确）。
 * triggerProcess 走 PipelineService.fireProcess（另由 process-scheduler.spec 覆盖），此处用桩、不调。
 */
describe('RadarService（读 / 聚合 / CRUD）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let blueprints: BlueprintsRepository;
  let runs: RunsRepository;
  let tasks: TasksRepository;
  let svc: RadarService;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    blueprints = new BlueprintsRepository(db);
    runs = new RunsRepository(db);
    tasks = new TasksRepository(db);
    svc = new RadarService(
      db,
      blueprints,
      new ProcessesRepository(db),
      {} as unknown as PipelineService,
      runs,
      tasks,
      new TaskStagesRepository(db),
      new RequestQueueRepository(db),
      new RequestLanesRepository(db),
      { getWorkerStatuses: () => [] } as unknown as GatewayService,
    );
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
        source: 'reddit',
        subreddit: 'SaaS',
        title: 'Churn is killing us',
        selftext: 'We lose 8% monthly.',
        score: 120,
        num_comments: 9,
        created_utc: BigInt(nowSec()),
        fetched_at: BigInt(nowSec()),
        comment_pass: 2,
      },
    });
  }

  async function seedInsight(postId = 'p1'): Promise<void> {
    await db.insights.create({
      data: {
        post_id: postId,
        source: 'reddit',
        subreddit: 'SaaS',
        post_title: 'Churn is killing us',
        model: 'model-x',
        intensity: 'HIGH',
        pain_points: [{ title: '流失', description: '月流失 8%', intensity: 'HIGH' }],
        opportunities: [{ title: '留存工具' }, { title: '回访邮件' }],
        tags: ['churn', 'retention'],
        created_at: BigInt(nowSec()),
      },
    });
  }

  it('图纸 CRUD：create → list 带 sources/gates/params', async () => {
    const bp = await svc.createBlueprint({
      kind: 'collect',
      label: '采集A',
      sources: [{ kind: 'reddit', channels: ['SaaS'] }],
      params: { limit: 50 },
      gates: ['collect:fetch_comments'],
    });
    expect(bp.id).toBeGreaterThan(0);
    const list = await svc.listBlueprints();
    expect(list).toHaveLength(1);
    expect(list[0].sources[0]).toEqual({ kind: 'reddit', channels: ['SaaS'] });
    expect(list[0].gates).toEqual(['collect:fetch_comments']);
    expect(list[0].params.limit).toBe(50);
  });

  it('进程 CRUD：create(interval) → list 带 trigger；删图纸被进程引用应拒绝', async () => {
    const bp = await svc.createBlueprint({ kind: 'collect', label: '采集B' });
    const created = await svc.createProcess({
      blueprintId: bp.id,
      label: '进程B',
      trigger: { kind: 'interval', everySec: 900 },
    });
    expect('error' in created).toBe(false);
    const procs = await svc.listProcesses();
    expect(procs).toHaveLength(1);
    expect(procs[0].trigger).toEqual({ kind: 'interval', everySec: 900 });
    expect(procs[0].blueprintKind).toBe('collect');
    const del = await svc.deleteBlueprint(bp.id);
    expect(del.ok).toBe(false); // 仍被进程引用
  });

  it('controlRoom：聚合 today / lanes / processes / recheck 不报错且形状正确', async () => {
    await seedPost();
    await seedInsight();
    const cr = await svc.controlRoom();
    expect(cr.today.insights).toBeGreaterThanOrEqual(1);
    expect(cr.today.posts).toBeGreaterThanOrEqual(1);
    expect(typeof cr.today.workers).toBe('number');
    expect(Array.isArray(cr.lanes)).toBe(true);
    expect(Array.isArray(cr.processes)).toBe(true);
    expect(typeof cr.recheck.sweep).toBe('number');
    expect(Array.isArray(cr.recheck.dist)).toBe(true);
  });

  it('listInsights：分页 + painPoint/oppCount/intensity 小写', async () => {
    await seedPost();
    await seedInsight();
    const page = await svc.listInsights({ sort: 'time', page: 1, size: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0].intensity).toBe('high');
    expect(page.items[0].painPoint).toBe('月流失 8%');
    expect(page.items[0].oppCount).toBe(2);
    expect(page.items[0].channel).toBe('SaaS');
    // 强度筛选
    const none = await svc.listInsights({ intensity: 'low' });
    expect(none.total).toBe(0);
  });

  it('insightDetail：痛点/机会/研判全展开 + intensity 小写 + postExists', async () => {
    await seedPost();
    await seedInsight();
    const id = (await svc.listInsights({ page: 1, size: 1 })).items[0].id;
    const d = await svc.insightDetail(id);
    expect(d).not.toBeNull();
    expect(d!.intensity).toBe('high');
    expect(d!.painPoints[0]).toMatchObject({ description: '月流失 8%', intensity: 'high' });
    expect(d!.opportunities).toHaveLength(2);
    expect(d!.opportunities[0].title).toBe('留存工具');
    expect(d!.tags).toEqual(['churn', 'retention']);
    expect(d!.model).toBe('model-x');
    expect(d!.postExists).toBe(true);
    expect(d!.triage).toBeNull();
    // 带研判时映射出 status/rating/tags/note
    await db.triage.create({
      data: {
        insight_id: id,
        status: 'shortlisted',
        rating: 4,
        tags: ['hot'],
        note: '看好',
        updated_at: BigInt(nowSec()),
      },
    });
    const d2 = await svc.insightDetail(id);
    expect(d2!.triage).toMatchObject({ status: 'shortlisted', rating: 4, tags: ['hot'], note: '看好' });
    // 不存在 → null
    expect(await svc.insightDetail(999999)).toBeNull();
  });

  it('filterOptions：洞察去重的来源 / 版块清单', async () => {
    await seedPost();
    await seedInsight();
    const opts = await svc.filterOptions();
    expect(opts.sources).toContain('reddit');
    expect(opts.subreddits).toContain('SaaS');
  });

  it('listPosts：分页 + 字段映射', async () => {
    await seedPost();
    const page = await svc.listPosts({ page: 1, size: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('p1');
    expect(page.items[0].channel).toBe('SaaS');
    expect(page.items[0].titleZh).toBeNull();
    expect(page.items[0].analyzed).toBe(false);
  });

  it('postDetail：帖 + 评论树 + 一生事件 + 洞察', async () => {
    await seedPost();
    await seedInsight();
    await db.comments.createMany({
      data: [
        { id: 'c1', post_id: 'p1', body: '顶级评论', depth: 0, created_utc: 1n, fetched_at: 1n },
        {
          id: 'c2',
          post_id: 'p1',
          parent_id: 'c1',
          body: '回复',
          depth: 1,
          created_utc: 2n,
          fetched_at: 2n,
        },
      ],
    });
    // 一条 collect run + 任务（构成一生事件）
    const bp = await blueprints.createBlueprint({ kind: 'collect', label: 'c' }, nowSec());
    const run = await runs.createRun(
      { blueprintId: bp.id, kind: 'collect', triggerSource: 'manual' },
      nowSec(),
    );
    await tasks.createTaskWithStages(
      { runId: run.id, kind: 'collect', postId: 'p1' },
      buildStages('collect'),
      nowSec(),
    );

    const detail = await svc.postDetail('p1');
    expect(detail).not.toBeNull();
    expect(detail!.post.id).toBe('p1');
    expect(detail!.comments).toHaveLength(1); // 一条顶级
    expect(detail!.comments[0].children).toHaveLength(1); // 一条回复
    expect(detail!.events.some((e) => e.kind === 'collect')).toBe(true);
    expect(detail!.insights).toHaveLength(1);
    expect(await svc.postDetail('nope')).toBeNull();
  });

  it('runDetail：运行 + 任务树（含环节 lane / 状态）', async () => {
    await seedPost();
    const bp = await blueprints.createBlueprint({ kind: 'collect', label: 'c' }, nowSec());
    const run = await runs.createRun(
      { blueprintId: bp.id, kind: 'collect', triggerSource: 'manual' },
      nowSec(),
    );
    await tasks.createTaskWithStages(
      { runId: run.id, kind: 'collect', postId: 'p1' },
      buildStages('collect'),
      nowSec(),
    );

    const detail = await svc.runDetail(run.id);
    expect(detail).not.toBeNull();
    expect(detail!.run.kind).toBe('collect');
    const collectTask = detail!.tasks.find((t) => t.kind === 'collect');
    expect(collectTask).toBeTruthy();
    expect(collectTask!.postTitle).toBe('Churn is killing us');
    // fetch_comments 环节 lane = reddit（按帖来源）
    const fetch = collectTask!.stages.find((s) => s.name === 'fetch_comments');
    expect(fetch?.lane).toBe('reddit');
    expect(await svc.runDetail(999999)).toBeNull();
  });
});
