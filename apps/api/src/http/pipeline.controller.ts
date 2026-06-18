import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import {
  BlueprintsRepository,
  PipelineService,
  RunsRepository,
  TaskStagesRepository,
  TasksRepository,
  type RunRow,
  type TaskRow,
  type TaskStageRow,
} from '@/domain';
import { logger } from '@/logger';

/** 进程总览取最近 N 条 */
const RECENT_RUNS_LIMIT = 50;

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('id 非法');
  return id;
}

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
 * /api/pipeline/* —— 图纸生命周期的「进程 / 任务」只读视图（鉴权 analyze:run）。
 *
 * - GET /api/pipeline/runs        最近进程总览（跨图纸，供「进程」页轮询）
 * - GET /api/pipeline/runs/:id    单进程详情：进程元信息 + 任务树（每任务含其环节轨迹）
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('analyze:run')
@Controller('pipeline')
export class PipelineController {
  constructor(
    private readonly runs: RunsRepository,
    private readonly tasks: TasksRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly blueprints: BlueprintsRepository,
    private readonly pipeline: PipelineService,
  ) {}

  /** 立即触发一轮采集（建 collect 进程 + discover 根任务，交 worker 抓取）。 */
  @Post('collect')
  @HttpCode(200)
  async runCollect() {
    const { runId } = await this.pipeline.runCollectSweep('manual');
    logger.info(`[采集] 手动触发 collect 进程#${runId}`);
    return { runId };
  }

  /** 最近进程总览（跨图纸，id 倒序）。 */
  @Get('runs')
  async listRuns() {
    const [runs, bps] = await Promise.all([
      this.runs.listAllRecent(RECENT_RUNS_LIMIT),
      this.blueprints.listBlueprints(),
    ]);
    const labelById = new Map(bps.map((b) => [b.id, b.label]));
    return { runs: runs.map((r) => toRunView(r, labelById.get(r.blueprint_id) ?? null)) };
  }

  /** 单进程详情：进程 + 任务树（每任务含其环节）。 */
  @Get('runs/:id')
  async runDetail(@Param('id') idRaw: string) {
    const id = parseId(idRaw);
    const run = await this.runs.getRun(id);
    if (!run) throw new NotFoundException('进程不存在');
    const bp = await this.blueprints.getBlueprint(run.blueprint_id);
    const tasks = await this.tasks.listByRun(id);
    const taskViews = await Promise.all(
      tasks.map(async (t) => toTaskView(t, await this.taskStages.listStages(t.id))),
    );
    return { run: toRunView(run, bp?.label ?? null), tasks: taskViews };
  }
}
