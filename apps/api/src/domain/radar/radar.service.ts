import {
  BlueprintsRepository,
  ProcessesRepository,
  RequestLanesRepository,
  RequestQueueRepository,
  RunsRepository,
  TaskStagesRepository,
  TasksRepository,
  toRunRow,
  type AppDatabase,
  type BlueprintRow,
  type ProcessRow,
  type RunRow,
  type TaskRow,
  type TaskStageRow,
} from '@hatch-radar/db';
import { nowSec } from '@hatch-radar/kernel';
import {
  PAGE_SIZE,
  STAGE_TEMPLATES,
  type BlueprintDTO,
  type BlueprintKind,
  type ControlRoomDTO,
  type LaneDTO,
  type Paged,
  type PostLifecycleEvent,
  type ProcessDTO,
  type RadarCommentDTO,
  type RadarInsightDTO,
  type RadarInsightFilter,
  type RadarLaneId,
  type RadarPostDTO,
  type RadarPostDetailDTO,
  type RadarPostFilter,
  type RadarTaskStatus,
  type RequestRowDTO,
  type RunDTO,
  type StageDTO,
  type TaskDTO,
  type TaskKind,
  type TriggerConfig,
} from '@hatch-radar/shared';
import { PipelineService } from '../pipeline/pipeline.service';

const ALERTS_LIMIT = 5;
const RECENT_PER_LANE = 8;
const PROCESS_RUNS_LIMIT = 50;

// ─── 纯映射 / 工具 ─────────────────────────────────────────────────────────────

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function toBlueprintDTO(b: BlueprintRow): BlueprintDTO {
  return {
    id: b.id,
    kind: b.kind as BlueprintKind,
    label: b.label,
    note: b.note,
    sources: Array.isArray(b.sources) ? (b.sources as unknown as BlueprintDTO['sources']) : [],
    params: asRecord(b.params),
    gates: asStrArr(b.gates),
    enabledStages: asStrArr(b.enabled_stages),
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

/** ProcessRow.trigger_kind + trigger_config → 前端 TriggerConfig 联合。 */
function triggerOf(p: ProcessRow): TriggerConfig {
  const cfg = asRecord(p.trigger_config);
  if (p.trigger_kind === 'interval') {
    return { kind: 'interval', everySec: typeof cfg.everySec === 'number' ? cfg.everySec : 0 };
  }
  if (p.trigger_kind === 'cron') {
    return { kind: 'cron', expr: typeof cfg.expr === 'string' ? cfg.expr : '' };
  }
  return { kind: 'once' };
}

/** 前端 TriggerConfig → { triggerKind, triggerConfig } 入库形状。 */
function triggerToRepo(t: TriggerConfig): { triggerKind: string; triggerConfig: unknown } {
  if (t.kind === 'interval')
    return { triggerKind: 'interval', triggerConfig: { everySec: t.everySec } };
  if (t.kind === 'cron') return { triggerKind: 'cron', triggerConfig: { expr: t.expr } };
  return { triggerKind: 'once', triggerConfig: null };
}

function toProcessDTO(p: ProcessRow, kind: BlueprintKind): ProcessDTO {
  return {
    id: p.id,
    blueprintId: p.blueprint_id,
    blueprintKind: kind,
    label: p.label,
    trigger: triggerOf(p),
    status: p.status === 'paused' ? 'paused' : 'active',
    sweepSeq: p.sweep_seq,
    runsTotal: p.runs_total,
    lastRunAt: p.last_run_at,
    nextRunAt: p.next_run_at,
  };
}

function toRunDTO(r: RunRow, blueprintLabel: string | null, processLabel: string | null): RunDTO {
  return {
    id: r.id,
    processId: r.process_id,
    processLabel,
    blueprintId: r.blueprint_id,
    blueprintLabel,
    kind: r.kind,
    status: r.status,
    triggerSource: r.trigger_source,
    sweepSeq: r.sweep_seq,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    tasksTotal: r.tasks_total,
    tasksDone: r.tasks_done,
    tasksSkipped: r.tasks_skipped,
    tasksFailed: r.tasks_failed,
  };
}

/** 环节 lane：fetch:'source'→帖来源、fetch:'ai'→ai、本地环节→null（按 STAGE_TEMPLATES 推导）。 */
function stageLane(kind: TaskKind, name: string, source: string | null): RadarLaneId | null {
  const def = STAGE_TEMPLATES[kind]?.find((s) => s.name === name);
  if (def?.fetch === 'ai') return 'ai';
  if (def?.fetch === 'source') {
    if (source === 'reddit' || source === 'hackernews' || source === 'rss') return source;
    return null;
  }
  return null;
}

/** 环节产物 jsonb → 人话摘要（展示用；不可解析则 null）。 */
function summarizeStage(name: string, output: unknown): string | null {
  const o = asRecord(output);
  const num = (k: string): number => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  switch (name) {
    case 'fetch_listing':
      return `新增 ${num('added')} · 更新 ${num('updated')}`;
    case 'dedup':
      return `候选 ${Array.isArray(o.toSpawn) ? (o.toSpawn as unknown[]).length : 0}`;
    case 'spawn':
      return `派生采集 ${num('collectSpawned')}`;
    case 'fetch_comments':
    case 'recrawl':
      return `评论 ${num('commentCount')}`;
    case 'persist':
      if ('changed' in o) return o.changed ? '有变化 → 重新分析' : '无变化 · 退避';
      if ('analyzeSpawned' in o) return o.analyzeSpawned ? '落库 · 派生分析' : '落库';
      if ('saved' in o) return o.saved ? '洞察已落库' : '无信号 · 未落库';
      return '落库';
    case 'ai_call':
      return 'AI 响应已落检查点';
    case 'translate':
      return `翻译 ${num('translated')} 段`;
    default:
      return null;
  }
}

function toStageDTO(s: TaskStageRow, kind: TaskKind, source: string | null): StageDTO {
  return {
    seq: s.seq,
    name: s.name,
    status: s.status as StageDTO['status'],
    gate: s.gate,
    lane: stageLane(kind, s.name, source),
    output: summarizeStage(s.name, s.output),
    error: s.error,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
  };
}

function firstPainPoint(painPoints: unknown, fallback: string): string {
  const first = (Array.isArray(painPoints) ? painPoints[0] : null) as {
    description?: string;
    title?: string;
  } | null;
  return first?.description ?? first?.title ?? fallback;
}

/**
 * 雷达指挥室读 / 聚合 / CRUD 编排服务（控制面）。
 *
 * - 读：control-room 聚合、运行详情、收成洞察 / 帖子库分页、帖子一生、lane 概览（合成 web 视图 DTO）。
 * - 写：图纸 / 进程 CRUD（委托仓储 + 校验）+ 触发进程（委托 {@link PipelineService.fireProcess}）。
 * 译文标题（titleZh）按 posts.title_hash 从 translations(done) 批量 join。
 */
export class RadarService {
  constructor(
    private readonly db: AppDatabase,
    private readonly blueprints: BlueprintsRepository,
    private readonly processes: ProcessesRepository,
    private readonly pipeline: PipelineService,
    private readonly runs: RunsRepository,
    private readonly tasks: TasksRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly requestQueue: RequestQueueRepository,
    private readonly requestLanes: RequestLanesRepository,
  ) {}

  // ─── 图纸 CRUD ───────────────────────────────────────────────────────────────

  async listBlueprints(): Promise<BlueprintDTO[]> {
    return (await this.blueprints.listBlueprints()).map(toBlueprintDTO);
  }

  async getBlueprint(id: number): Promise<BlueprintDTO | null> {
    const b = await this.blueprints.getBlueprint(id);
    return b ? toBlueprintDTO(b) : null;
  }

  async createBlueprint(input: {
    kind: string;
    label: string;
    note?: string | null;
    sources?: unknown;
    params?: unknown;
    gates?: string[];
    enabledStages?: string[];
  }): Promise<BlueprintDTO> {
    const b = await this.blueprints.createBlueprint(input, nowSec());
    return toBlueprintDTO(b);
  }

  async updateBlueprint(
    id: number,
    patch: {
      label?: string;
      note?: string | null;
      sources?: unknown;
      params?: unknown;
      gates?: string[];
      enabledStages?: string[];
    },
  ): Promise<void> {
    await this.blueprints.updateBlueprint(id, patch, nowSec());
  }

  /** 删图纸：被进程引用则拒绝（返回 false），否则删除。 */
  async deleteBlueprint(id: number): Promise<{ ok: boolean; reason?: string }> {
    const used = (await this.processes.listProcesses(id)).length > 0;
    if (used) return { ok: false, reason: '该图纸仍被进程引用，请先删除其进程' };
    await this.blueprints.deleteBlueprint(id);
    return { ok: true };
  }

  // ─── 进程 CRUD + 触发 ─────────────────────────────────────────────────────────

  async listProcesses(): Promise<ProcessDTO[]> {
    const [procs, bps] = await Promise.all([
      this.processes.listProcesses(),
      this.blueprints.listBlueprints(),
    ]);
    const kindById = new Map(bps.map((b) => [b.id, b.kind as BlueprintKind]));
    return procs.map((p) => toProcessDTO(p, kindById.get(p.blueprint_id) ?? 'collect'));
  }

  async getProcess(id: number): Promise<ProcessDTO | null> {
    const p = await this.processes.getProcess(id);
    if (!p) return null;
    const bp = await this.blueprints.getBlueprint(p.blueprint_id);
    return toProcessDTO(p, (bp?.kind as BlueprintKind) ?? 'collect');
  }

  async createProcess(input: {
    blueprintId: number;
    label: string;
    trigger: TriggerConfig;
  }): Promise<ProcessDTO | { error: string }> {
    const bp = await this.blueprints.getBlueprint(input.blueprintId);
    if (!bp) return { error: '绑定的图纸不存在' };
    const { triggerKind, triggerConfig } = triggerToRepo(input.trigger);
    // once 不自动触发；interval/cron 稍后即到期（首个心跳触发）
    const nextRunAt = input.trigger.kind === 'once' ? null : nowSec();
    const p = await this.processes.createProcess(
      { blueprintId: input.blueprintId, label: input.label, triggerKind, triggerConfig, nextRunAt },
      nowSec(),
    );
    return toProcessDTO(p, bp.kind as BlueprintKind);
  }

  async updateProcess(
    id: number,
    patch: { label?: string; trigger?: TriggerConfig },
  ): Promise<void> {
    const repoPatch: {
      label?: string;
      triggerKind?: string;
      triggerConfig?: unknown;
      nextRunAt?: number | null;
    } = {};
    if (patch.label !== undefined) repoPatch.label = patch.label;
    if (patch.trigger) {
      const { triggerKind, triggerConfig } = triggerToRepo(patch.trigger);
      repoPatch.triggerKind = triggerKind;
      repoPatch.triggerConfig = triggerConfig;
      // 改了节奏：active 进程重排到「即将触发」，once 置空
      const p = await this.processes.getProcess(id);
      if (p?.status === 'active')
        repoPatch.nextRunAt = patch.trigger.kind === 'once' ? null : nowSec();
    }
    await this.processes.updateProcess(id, repoPatch, nowSec());
  }

  /** 暂停进程：status=paused + next_run_at=null（停止自动触发）。 */
  async pauseProcess(id: number): Promise<void> {
    await this.processes.setStatus(id, 'paused', nowSec());
    await this.processes.setNextRunAt(id, null, nowSec());
  }

  /** 恢复进程：status=active + 重排下次触发（once 仍置空）。 */
  async resumeProcess(id: number): Promise<void> {
    const p = await this.processes.getProcess(id);
    if (!p) return;
    await this.processes.setStatus(id, 'active', nowSec());
    await this.processes.setNextRunAt(id, p.trigger_kind === 'once' ? null : nowSec(), nowSec());
  }

  /** 手动触发一次：已有进行中运行则拒绝；否则 fireProcess(manual)。 */
  async triggerProcess(id: number): Promise<{ ok: boolean; reason?: string }> {
    const p = await this.processes.getProcess(id);
    if (!p) return { ok: false, reason: '进程不存在' };
    if (await this.runs.hasRunningRunForProcess(id)) {
      return { ok: false, reason: '该进程已有进行中的运行' };
    }
    await this.pipeline.fireProcess(p, 'manual');
    return { ok: true };
  }

  async deleteProcess(id: number): Promise<void> {
    await this.processes.deleteProcess(id);
  }

  // ─── 运行 ────────────────────────────────────────────────────────────────────

  /** 单进程的运行历史。 */
  async processRuns(processId: number): Promise<{ process: ProcessDTO | null; runs: RunDTO[] }> {
    const process = await this.getProcess(processId);
    const rows = await this.db.runs.findMany({
      where: { process_id: processId },
      orderBy: { id: 'desc' },
      take: PROCESS_RUNS_LIMIT,
    });
    const bp = process ? await this.blueprints.getBlueprint(process.blueprintId) : null;
    return {
      process,
      runs: rows.map((r) => toRunDTO(toRunRow(r), bp?.label ?? null, process?.label ?? null)),
    };
  }

  /** 运行详情：运行 + 任务树（每任务含环节，lane / 产物摘要已合成）。 */
  async runDetail(id: number): Promise<{ run: RunDTO; tasks: TaskDTO[] } | null> {
    const run = await this.runs.getRun(id);
    if (!run) return null;
    const [bp, proc, tasks] = await Promise.all([
      this.blueprints.getBlueprint(run.blueprint_id),
      run.process_id != null ? this.processes.getProcess(run.process_id) : Promise.resolve(null),
      this.tasks.listByRun(id),
    ]);
    const postIds = [...new Set(tasks.map((t) => t.post_id).filter((x): x is string => x != null))];
    const posts = postIds.length
      ? await this.db.posts.findMany({
          where: { id: { in: postIds } },
          select: { id: true, source: true, title: true },
        })
      : [];
    const postById = new Map(posts.map((p) => [p.id, p]));
    const taskViews: TaskDTO[] = await Promise.all(
      tasks.map(async (t) => {
        const stages = await this.taskStages.listStages(t.id);
        const post = t.post_id != null ? postById.get(t.post_id) : undefined;
        return this.toTaskDTO(t, stages, post?.source ?? null, post?.title ?? null);
      }),
    );
    return {
      run: toRunDTO(run, bp?.label ?? null, proc?.label ?? null),
      tasks: taskViews,
    };
  }

  private toTaskDTO(
    t: TaskRow,
    stages: TaskStageRow[],
    source: string | null,
    postTitle: string | null,
  ): TaskDTO {
    const kind = t.kind as TaskKind;
    return {
      id: t.id,
      runId: t.run_id,
      kind,
      status: t.status as RadarTaskStatus,
      parentTaskId: t.parent_task_id,
      postId: t.post_id,
      postTitle,
      model: t.model,
      attempts: t.attempts,
      error: t.error,
      enqueuedAt: t.enqueued_at,
      startedAt: t.started_at,
      finishedAt: t.finished_at,
      stages: stages.map((s) => toStageDTO(s, kind, source)),
    };
  }

  // ─── lane 概览 ────────────────────────────────────────────────────────────────

  async lanes(): Promise<LaneDTO[]> {
    const now = nowSec();
    const [lanes, recent, counts] = await Promise.all([
      this.requestLanes.listLanes(),
      this.requestQueue.listRecent(120),
      this.requestQueue.laneCounts(now - 60), // 近 60s 完成数 ≈ 每分钟速率
    ]);
    const countByLane = new Map(counts.map((c) => [c.lane, c]));
    const recentByLane = new Map<string, RequestRowDTO[]>();
    for (const r of recent) {
      const list = recentByLane.get(r.lane) ?? [];
      if (list.length < RECENT_PER_LANE) {
        list.push({
          id: r.id,
          lane: r.lane,
          purpose: r.purpose,
          ownerTaskId: r.owner_task_id,
          status: r.status,
          detail: r.url,
          enqueuedAt: r.enqueued_at,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
        });
        recentByLane.set(r.lane, list);
      }
    }
    return lanes.map((l) => {
      const c = countByLane.get(l.lane);
      const depth = c?.running ?? 0;
      const rate = c?.recent ?? 0;
      return {
        id: l.lane,
        label: l.lane,
        ratePerMin: l.rate_per_minute,
        paused: l.paused,
        rate,
        depth,
        etaSec: rate > 0 && depth > 0 ? Math.round((depth / rate) * 60) : null,
        recent: recentByLane.get(l.lane) ?? [],
      };
    });
  }

  // ─── 指挥室聚合 ────────────────────────────────────────────────────────────────

  async controlRoom(): Promise<ControlRoomDTO> {
    const now = nowSec();
    const dayStart = now - (now % 86400);
    const [insightsToday, postsToday, runsToday, taskStats, lanes, procDtos, runningRuns, recheck] =
      await Promise.all([
        this.db.insights.count({ where: { created_at: { gte: BigInt(dayStart) } } }),
        this.db.posts.count({ where: { fetched_at: { gte: BigInt(dayStart) } } }),
        this.db.runs.count({ where: { started_at: { gte: BigInt(dayStart) } } }),
        this.tasks.taskStats(),
        this.lanes(),
        this.listProcesses(),
        this.runs.listRunningRuns(), // 进行中运行（用于 activeRun）
        this.recheckHealth(now),
      ]);

    // 每进程的进行中运行（复用 listRunningRuns 结果，已是 RunRow）
    const runningByProcess = new Map<number, RunRow>();
    for (const r of runningRuns) {
      if (r.process_id != null) runningByProcess.set(r.process_id, r);
    }
    const processes = procDtos.map((p) => {
      const run = runningByProcess.get(p.id);
      return {
        ...p,
        activeRun: run
          ? {
              id: run.id,
              tasksTotal: run.tasks_total,
              tasksDone: run.tasks_done,
              tasksFailed: run.tasks_failed,
            }
          : null,
      };
    });

    const failedRuns = await this.db.runs.findMany({
      where: { status: 'failed' },
      orderBy: { id: 'desc' },
      take: ALERTS_LIMIT,
    });
    const bps = await this.blueprints.listBlueprints();
    const bpLabel = new Map(bps.map((b) => [b.id, b.label]));

    return {
      today: {
        insights: insightsToday,
        posts: postsToday,
        runs: runsToday,
        inflight: taskStats.queued + taskStats.running + taskStats.paused,
      },
      lanes,
      processes,
      alerts: failedRuns.map((r) =>
        toRunDTO(toRunRow(r), bpLabel.get(r.blueprint_id) ?? null, null),
      ),
      recheck,
    };
  }

  private async recheckHealth(now: number): Promise<ControlRoomDTO['recheck']> {
    void now;
    const sweepAgg = await this.db.runs.aggregate({
      where: { kind: 'recheck' },
      _max: { sweep_seq: true },
    });
    const sweep = sweepAgg._max.sweep_seq ?? 0;
    const [dueNow, distRows] = await Promise.all([
      this.db.posts.count({
        where: {
          source: { not: 'rss' },
          comment_pass: { gte: 1 },
          recheck_due_sweep: { lte: sweep },
        },
      }),
      this.db.posts.groupBy({
        by: ['recheck_misses'],
        where: { source: { not: 'rss' }, comment_pass: { gte: 1 } },
        _count: { _all: true },
      }),
    ]);
    const dist = distRows
      .map((r) => ({ misses: r.recheck_misses, count: r._count._all }))
      .sort((a, b) => a.misses - b.misses);
    return { sweep, dueNow, dist };
  }

  // ─── 收成洞察（分页） ───────────────────────────────────────────────────────────

  async listInsights(f: RadarInsightFilter): Promise<Paged<RadarInsightDTO>> {
    const size = f.size && f.size > 0 ? f.size : PAGE_SIZE;
    const where: Record<string, unknown> = {};
    if (f.source) where.source = f.source;
    if (f.intensity) where.intensity = f.intensity.toUpperCase();
    if (f.q) where.post_title = { contains: f.q, mode: 'insensitive' };
    const total = await this.db.insights.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(1, f.page ?? 1), pageCount);
    const orderBy =
      f.sort === 'pain'
        ? [{ intensity: 'asc' as const }, { created_at: 'desc' as const }]
        : [{ created_at: 'desc' as const }];
    const rows = await this.db.insights.findMany({
      where,
      orderBy,
      skip: (page - 1) * size,
      take: size,
    });
    const titleZhByPost = await this.titleZhForPosts(rows.map((r) => r.post_id));
    const items: RadarInsightDTO[] = rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      source: r.source,
      channel: r.subreddit,
      postTitle: r.post_title,
      titleZh: titleZhByPost.get(r.post_id) ?? null,
      intensity: (r.intensity as string).toLowerCase() as RadarInsightDTO['intensity'],
      painPoint: firstPainPoint(r.pain_points, r.post_title),
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      oppCount: Array.isArray(r.opportunities) ? (r.opportunities as unknown[]).length : 0,
      createdAt: Number(r.created_at),
    }));
    return { items, total, page, pageCount };
  }

  // ─── 帖子库（分页） ─────────────────────────────────────────────────────────────

  async listPosts(f: RadarPostFilter): Promise<Paged<RadarPostDTO>> {
    const size = f.size && f.size > 0 ? f.size : PAGE_SIZE;
    const sweepAgg = await this.db.runs.aggregate({
      where: { kind: 'recheck' },
      _max: { sweep_seq: true },
    });
    const sweep = sweepAgg._max.sweep_seq ?? 0;
    const where: Record<string, unknown> = {};
    if (f.source) where.source = f.source;
    if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
    if (f.status === 'new') where.last_rechecked_at = null;
    else if (f.status === 'quiet') where.recheck_misses = { gt: 0 };
    else if (f.status === 'due')
      Object.assign(where, {
        source: { not: 'rss' },
        comment_pass: { gte: 1 },
        recheck_due_sweep: { lte: sweep },
      });
    const total = await this.db.posts.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(1, f.page ?? 1), pageCount);
    const rows = await this.db.posts.findMany({
      where,
      orderBy: { created_utc: 'desc' },
      skip: (page - 1) * size,
      take: size,
    });
    const zhByHash = await this.translationsByHash(
      rows.flatMap((r) => [r.title_hash, r.selftext_hash].filter((x): x is string => x != null)),
    );
    const items: RadarPostDTO[] = rows.map((p) => ({
      id: p.id,
      source: p.source,
      channel: p.subreddit,
      title: p.title,
      titleZh: p.title_hash ? (zhByHash.get(p.title_hash) ?? null) : null,
      body: p.selftext,
      bodyZh: p.selftext_hash ? (zhByHash.get(p.selftext_hash) ?? null) : null,
      titleHash: p.title_hash,
      selftextHash: p.selftext_hash,
      author: p.author,
      score: p.score,
      numComments: p.num_comments,
      createdUtc: Number(p.created_utc),
      recheckMisses: p.recheck_misses,
      recheckDueSweep: p.recheck_due_sweep,
      lastRecheckedAt: p.last_rechecked_at == null ? null : Number(p.last_rechecked_at),
      analyzed: p.analyzed_at != null,
    }));
    return { items, total, page, pageCount };
  }

  // ─── 帖子一生（详情） ──────────────────────────────────────────────────────────

  async postDetail(id: string): Promise<RadarPostDetailDTO | null> {
    const p = await this.db.posts.findUnique({ where: { id } });
    if (!p) return null;
    const [commentRows, taskRows, insightRow, zhByHash] = await Promise.all([
      this.db.comments.findMany({
        where: { post_id: id },
        orderBy: [{ depth: 'asc' }, { score: 'desc' }],
      }),
      this.db.tasks.findMany({ where: { post_id: id }, orderBy: { id: 'asc' } }),
      this.db.insights.findUnique({ where: { post_id: id } }),
      this.translationsByHash(
        [p.title_hash, p.selftext_hash].filter((x): x is string => x != null),
      ),
    ]);
    // 跨运行一生时间线
    const runIds = [...new Set(taskRows.map((t) => t.run_id))];
    const runRows = runIds.length
      ? await this.db.runs.findMany({
          where: { id: { in: runIds } },
          select: { id: true, sweep_seq: true },
        })
      : [];
    const sweepByRun = new Map(runRows.map((r) => [r.id, r.sweep_seq]));
    const events: PostLifecycleEvent[] = taskRows.map((t) => ({
      taskId: t.id,
      runId: t.run_id,
      kind: t.kind as TaskKind,
      status: t.status as RadarTaskStatus,
      sweepSeq: sweepByRun.get(t.run_id) ?? null,
      at: Number(t.finished_at ?? t.enqueued_at),
    }));
    const post: RadarPostDTO = {
      id: p.id,
      source: p.source,
      channel: p.subreddit,
      title: p.title,
      titleZh: p.title_hash ? (zhByHash.get(p.title_hash) ?? null) : null,
      body: p.selftext,
      bodyZh: p.selftext_hash ? (zhByHash.get(p.selftext_hash) ?? null) : null,
      titleHash: p.title_hash,
      selftextHash: p.selftext_hash,
      author: p.author,
      score: p.score,
      numComments: p.num_comments,
      createdUtc: Number(p.created_utc),
      recheckMisses: p.recheck_misses,
      recheckDueSweep: p.recheck_due_sweep,
      lastRecheckedAt: p.last_rechecked_at == null ? null : Number(p.last_rechecked_at),
      analyzed: p.analyzed_at != null,
    };
    const insights: RadarInsightDTO[] = insightRow
      ? [
          {
            id: insightRow.id,
            postId: insightRow.post_id,
            source: insightRow.source,
            channel: insightRow.subreddit,
            postTitle: insightRow.post_title,
            titleZh: post.titleZh,
            intensity: (
              insightRow.intensity as string
            ).toLowerCase() as RadarInsightDTO['intensity'],
            painPoint: firstPainPoint(insightRow.pain_points, insightRow.post_title),
            tags: Array.isArray(insightRow.tags) ? (insightRow.tags as string[]) : [],
            oppCount: Array.isArray(insightRow.opportunities)
              ? (insightRow.opportunities as unknown[]).length
              : 0,
            createdAt: Number(insightRow.created_at),
          },
        ]
      : [];
    return { post, comments: buildCommentTree(commentRows), events, insights };
  }

  // ─── 译文 join 辅助 ────────────────────────────────────────────────────────────

  /** content_hash → 中文译文（status=done）。 */
  private async translationsByHash(hashes: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(hashes)];
    if (uniq.length === 0) return new Map();
    const rows = await this.db.translations.findMany({
      where: { content_hash: { in: uniq }, status: 'done', text: { not: null } },
      select: { content_hash: true, text: true },
    });
    return new Map(rows.map((r) => [r.content_hash, r.text as string]));
  }

  /** 帖子 id → 标题译文（经 posts.title_hash join translations）。 */
  private async titleZhForPosts(postIds: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(postIds)];
    if (uniq.length === 0) return new Map();
    const posts = await this.db.posts.findMany({
      where: { id: { in: uniq } },
      select: { id: true, title_hash: true },
    });
    const hashByPost = new Map(posts.map((p) => [p.id, p.title_hash]));
    const zhByHash = await this.translationsByHash(
      posts.map((p) => p.title_hash).filter((x): x is string => x != null),
    );
    const out = new Map<string, string>();
    for (const [postId, hash] of hashByPost) {
      const zh = hash ? zhByHash.get(hash) : undefined;
      if (zh) out.set(postId, zh);
    }
    return out;
  }
}

/** 评论平铺列表 → 楼层树（按 parent_id）。 */
function buildCommentTree(
  rows: {
    id: string;
    parent_id: string | null;
    author: string | null;
    body: string;
    score: number;
    depth: number;
    created_utc: bigint;
    body_hash: string | null;
  }[],
): RadarCommentDTO[] {
  const byId = new Map<string, RadarCommentDTO>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      author: r.author,
      score: r.score,
      depth: r.depth,
      body: r.body,
      bodyHash: r.body_hash,
      createdUtc: Number(r.created_utc),
      children: [],
    });
  }
  const roots: RadarCommentDTO[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
