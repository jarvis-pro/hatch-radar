import { Injectable } from '@nestjs/common';
import {
  BlueprintsRepository,
  RunsRepository,
  TaskStagesRepository,
  TasksRepository,
  type RunRow,
  type TaskRow,
  type TaskStageRow,
} from '@/lib/db';

/** 进程总览取最近 N 条 */
const RECENT_RUNS_LIMIT = 50;

/** RunRow → 进程视图（camelCase，附图纸展示名） */
function toRunView(r: RunRow, blueprintLabel: string | null) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    triggerSource: r.trigger_source,
    sweepSeq: r.sweep_seq,
    blueprintLabel,
    tasksTotal: r.tasks_total,
    tasksDone: r.tasks_done,
    tasksSkipped: r.tasks_skipped,
    tasksFailed: r.tasks_failed,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

/** TaskStageRow → 环节视图 */
function toStageView(s: TaskStageRow) {
  return {
    seq: s.seq,
    name: s.name,
    status: s.status,
    gate: s.gate,
    error: s.error,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
  };
}

/** TaskRow + 其环节 → 任务树节点视图 */
function toTaskView(t: TaskRow, stages: TaskStageRow[]) {
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    parentTaskId: t.parent_task_id,
    postId: t.post_id,
    model: t.model,
    attempts: t.attempts,
    error: t.error,
    startedAt: t.started_at,
    finishedAt: t.finished_at,
    inputTokens: t.input_tokens,
    outputTokens: t.output_tokens,
    stages: stages.map(toStageView),
  };
}

/**
 * 图纸生命周期「进程 / 任务」只读视图服务（控制面）。
 *
 * 从 PipelineController 抽出的查询编排：跨图纸进程总览、单进程任务树、在飞计数。
 * 触发 / 逐环节闸门控制仍直接走 {@link PipelineService}（控制器薄委托）。
 */
@Injectable()
export class PipelineQueryService {
  constructor(
    private readonly runs: RunsRepository,
    private readonly tasks: TasksRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly blueprints: BlueprintsRepository,
  ) {}

  /** 在飞任务计数（排队 + 运行中）：侧栏「进程」红点轮询用，避免拉整张看板。 */
  async inflight(): Promise<{ stats: { queued: number; running: number } }> {
    const stats = await this.tasks.taskStats();
    return { stats: { queued: stats.queued, running: stats.running } };
  }

  /** 最近进程总览（跨图纸，id 倒序）。 */
  async listRuns() {
    const [runs, bps] = await Promise.all([
      this.runs.listAllRecent(RECENT_RUNS_LIMIT),
      this.blueprints.listBlueprints(),
    ]);
    const labelById = new Map(bps.map((b) => [b.id, b.label]));
    return { runs: runs.map((r) => toRunView(r, labelById.get(r.blueprint_id) ?? null)) };
  }

  /** 单进程详情：进程 + 任务树（每任务含其环节）。不存在返回 null。 */
  async runDetail(id: number) {
    const run = await this.runs.getRun(id);
    if (!run) return null;
    const bp = await this.blueprints.getBlueprint(run.blueprint_id);
    const tasks = await this.tasks.listByRun(id);
    const taskViews = await Promise.all(
      tasks.map(async (t) => toTaskView(t, await this.taskStages.listStages(t.id))),
    );
    return { run: toRunView(run, bp?.label ?? null), tasks: taskViews };
  }
}
