import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase, DbHandle } from '@/lib/db';
import {
  BlueprintsRepository,
  PostsRepository,
  ProcessesRepository,
  RunsRepository,
  TasksRepository,
} from '@/lib/db';
import { RuntimeSettingsService } from '@/domain/settings/runtime-settings.service';
import type { AnalysisConfigService } from '@/domain/analysis/analysis-config.service';
import type { Dispatcher } from '@/lib/kernel';
import { nowSec } from '@/lib/kernel';
import { PipelineService } from '@/domain';
import { setupTestDb, truncateAll } from './helpers';

/**
 * 进程调度（取代旧 4 个固定 @Cron）：心跳 fire 到期进程 → 建运行 + 任务 + markFired；
 * finalize 把任务全终结的运行收尾并为 interval 进程重排；空轮（recheck 无到期帖）即时完成并重排；
 * paused / 未到期进程不触发。crawler / AI 不参与（collect/recheck fire 仅建运行+任务），故 stub 即可。
 */
describe('进程调度（ProcessScheduler：fire / finalize / 重排）', () => {
  let handle: DbHandle;
  let db: AppDatabase;
  let blueprints: BlueprintsRepository;
  let processes: ProcessesRepository;
  let runs: RunsRepository;
  let tasks: TasksRepository;
  let svc: PipelineService;

  beforeAll(() => {
    handle = setupTestDb();
    db = handle.db;
    blueprints = new BlueprintsRepository(db);
    processes = new ProcessesRepository(db);
    runs = new RunsRepository(db);
    tasks = new TasksRepository(db);
    const gateway: Dispatcher = { tryDispatch: () => Promise.resolve() };
    svc = new PipelineService(
      blueprints,
      runs,
      tasks,
      new PostsRepository(db),
      {} as unknown as AnalysisConfigService,
      {} as unknown as RuntimeSettingsService,
      processes,
      gateway,
    );
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  /** 建图纸 + 绑定一个 interval 进程（默认已到期、active）。 */
  async function makeProcess(
    kind: 'collect' | 'recheck',
    opts: { status?: string; nextRunAt?: number | null } = {},
  ): Promise<{ blueprintId: number; processId: number }> {
    const bp = await blueprints.createBlueprint({ kind, label: kind }, nowSec());
    const proc = await processes.createProcess(
      {
        blueprintId: bp.id,
        label: kind,
        triggerKind: 'interval',
        triggerConfig: { everySec: 1800 },
        status: opts.status ?? 'active',
        nextRunAt: opts.nextRunAt === undefined ? nowSec() - 1 : opts.nextRunAt,
      },
      nowSec(),
    );
    return { blueprintId: bp.id, processId: proc.id };
  }

  it('到期 collect 进程 → 建 collect 运行 + discover 任务 + 记账（next_run_at 待 finalize 才排）', async () => {
    const { processId } = await makeProcess('collect');
    await svc.fireDueProcesses();

    const run = (await runs.listAllRecent(10)).find((r) => r.process_id === processId);
    expect(run).toBeTruthy();
    expect(run!.kind).toBe('collect');
    expect(run!.status).toBe('running');
    expect((await tasks.listByRun(run!.id)).some((t) => t.kind === 'discover')).toBe(true);

    const after = (await processes.getProcess(processId))!;
    expect(after.runs_total).toBe(1);
    expect(after.last_run_at).not.toBeNull();
    expect(after.next_run_at).toBeNull(); // 运行进行中：待 finalize 才重排
  });

  it('finalize：运行任务全终结 → 运行 completed + interval 进程重排', async () => {
    const { processId } = await makeProcess('collect');
    await svc.fireDueProcesses();
    const run = (await runs.listAllRecent(10)).find((r) => r.process_id === processId)!;
    for (const t of await tasks.listByRun(run.id)) await tasks.succeedTask(t.id, nowSec());

    await svc.finalizeRunningRuns();

    expect((await runs.getRun(run.id))!.status).toBe('completed');
    const after = (await processes.getProcess(processId))!;
    expect(after.next_run_at).not.toBeNull();
    expect(after.next_run_at!).toBeGreaterThan(nowSec()); // 重排到 ~now+1800
  });

  it('空轮 recheck（无到期帖）→ 运行即时 completed + sweep 自增 + 进程重排', async () => {
    const { processId } = await makeProcess('recheck');
    await svc.fireDueProcesses();

    const run = (await runs.listAllRecent(10)).find((r) => r.process_id === processId)!;
    expect(run.kind).toBe('recheck');
    expect(run.status).toBe('completed'); // 0 到期帖 → 即时完成
    expect(run.sweep_seq).toBe(1);
    const after = (await processes.getProcess(processId))!;
    expect(after.sweep_seq).toBe(1);
    expect(after.next_run_at).not.toBeNull(); // 空轮已重排
  });

  it('paused 进程不被触发', async () => {
    const { processId } = await makeProcess('collect', { status: 'paused' });
    await svc.fireDueProcesses();
    expect((await runs.listAllRecent(10)).find((r) => r.process_id === processId)).toBeUndefined();
  });

  it('未到期进程（next_run_at 在未来）不被触发', async () => {
    const { processId } = await makeProcess('collect', { nextRunAt: nowSec() + 3600 });
    await svc.fireDueProcesses();
    expect((await runs.listAllRecent(10)).find((r) => r.process_id === processId)).toBeUndefined();
  });
});
