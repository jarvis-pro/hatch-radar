import {
  BadRequestException,
  Body,
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

  /** 立即触发一轮复查 sweep（选到期旧帖派生 recheck 任务）。 */
  @Post('recheck')
  @HttpCode(200)
  async runRecheck() {
    const { runId, sweep, due } = await this.pipeline.runRecheckSweep('manual');
    logger.info(`[复查] 手动触发 recheck sweep#${sweep} 进程#${runId}（${due} 到期）`);
    return { runId, sweep, due };
  }

  /** 在飞任务计数（排队 + 运行中）：侧栏「进程」红点轮询用，避免拉整张看板。 */
  @Get('inflight')
  async inflight() {
    const stats = await this.tasks.taskStats();
    return { stats: { queued: stats.queued, running: stats.running } };
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

  // ─── 逐环节闸门控制（任意 kind 通用；与 /api/analysis/inspect/* 共用 PipelineService 同一组方法）──

  /** 放行暂停中的任务（静停于闸门→续跑）：paused→queued + 派发。 */
  @Post('tasks/:id/resume')
  @HttpCode(200)
  async resumeTask(@Param('id') idRaw: string) {
    const ok = await this.pipeline.resumeInspect(parseId(idRaw));
    if (!ok) throw new BadRequestException('当前不可放行（任务并非暂停态）');
    return { ok: true };
  }

  /** 运行到底：清除剩余环节闸门并放行，连续跑完（仍留轨迹）。 */
  @Post('tasks/:id/run-to-end')
  @HttpCode(200)
  async runTaskToEnd(@Param('id') idRaw: string) {
    await this.pipeline.runInspectToEnd(parseId(idRaw));
    return { ok: true };
  }

  /** 重试当前失败环节：复位失败环节 + 任务 failed→queued + 派发。 */
  @Post('tasks/:id/retry')
  @HttpCode(200)
  async retryTask(@Param('id') idRaw: string) {
    const res = await this.pipeline.retryInspectStep(parseId(idRaw));
    if (!res.ok) throw new BadRequestException(res.error ?? '当前不可重试');
    return { ok: true };
  }

  /** 取消任务：活跃态（queued/running/paused）→ canceled。 */
  @Post('tasks/:id/cancel')
  @HttpCode(200)
  async cancelTask(@Param('id') idRaw: string) {
    const ok = await this.pipeline.cancelInspect(parseId(idRaw));
    if (!ok) throw new BadRequestException('当前不可取消（任务已是终态）');
    return { ok: true };
  }

  /** 运行前挂 / 摘某环节暂停点（body.gate）；仅 pending 环节可改。 */
  @Post('tasks/:id/stages/:seq/gate')
  @HttpCode(200)
  async toggleStageGate(
    @Param('id') idRaw: string,
    @Param('seq') seqRaw: string,
    @Body() body: { gate?: boolean },
  ) {
    const seq = Number(seqRaw);
    if (!Number.isInteger(seq) || seq < 0) throw new BadRequestException('seq 非法');
    const ok = await this.pipeline.toggleStageGate(parseId(idRaw), seq, body.gate === true);
    if (!ok) throw new BadRequestException('当前不可设置暂停点（环节非待执行）');
    return { ok: true };
  }
}
