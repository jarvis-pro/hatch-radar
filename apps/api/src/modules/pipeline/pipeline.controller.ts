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
import { RequirePermission } from '@/modules/account/auth-user.decorator';
import { SessionAuthGuard } from '@/modules/account/session-auth.guard';
import { PipelineQueryService } from '@/modules/pipeline/pipeline-query.service';
import { PipelineService } from '@/modules/pipeline/pipeline.service';
import { TaskControlService } from '@/modules/pipeline/task-control.service';
import { logger } from '@/logger';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException('id 非法');
  }

  return id;
}

/**
 * /api/pipeline/* —— 图纸生命周期的「进程 / 任务」只读视图 + 触发 + 逐环节闸门控制（鉴权 analyze:run）。
 *
 * 只读视图（runs / runs/:id / inflight）委托 {@link PipelineQueryService}；触发（collect / recheck）委托
 * {@link PipelineService}；逐环节闸门控制委托 {@link TaskControlService}（与 /api/analysis/inspect/* 共用同一组方法）。
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('analyze:run')
@Controller('pipeline')
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly taskControl: TaskControlService,
    private readonly query: PipelineQueryService,
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
  inflight() {
    return this.query.inflight();
  }

  /** 最近进程总览（跨图纸，id 倒序）。 */
  @Get('runs')
  listRuns() {
    return this.query.listRuns();
  }

  /** 单进程详情：进程 + 任务树（每任务含其环节）。 */
  @Get('runs/:id')
  async runDetail(@Param('id') idRaw: string) {
    const res = await this.query.runDetail(parseId(idRaw));
    if (!res) {
      throw new NotFoundException('进程不存在');
    }

    return res;
  }

  // ─── 逐环节闸门控制（任意 kind 通用；与 /api/analysis/inspect/* 共用 TaskControlService 同一组方法）──

  /** 放行暂停中的任务（静停于闸门→续跑）：paused→queued + 派发。 */
  @Post('tasks/:id/resume')
  @HttpCode(200)
  async resumeTask(@Param('id') idRaw: string) {
    const ok = await this.taskControl.resumeInspect(parseId(idRaw));
    if (!ok) {
      throw new BadRequestException('当前不可放行（任务并非暂停态）');
    }

    return { ok: true };
  }

  /** 运行到底：清除剩余环节闸门并放行，连续跑完（仍留轨迹）。 */
  @Post('tasks/:id/run-to-end')
  @HttpCode(200)
  async runTaskToEnd(@Param('id') idRaw: string) {
    await this.taskControl.runInspectToEnd(parseId(idRaw));

    return { ok: true };
  }

  /** 重试当前失败环节：复位失败环节 + 任务 failed→queued + 派发。不可重试时 400（服务抛 DomainError）。 */
  @Post('tasks/:id/retry')
  @HttpCode(200)
  async retryTask(@Param('id') idRaw: string) {
    await this.taskControl.retryInspectStep(parseId(idRaw));

    return { ok: true };
  }

  /** 取消任务：活跃态（queued/running/paused）→ canceled。 */
  @Post('tasks/:id/cancel')
  @HttpCode(200)
  async cancelTask(@Param('id') idRaw: string) {
    const ok = await this.taskControl.cancelInspect(parseId(idRaw));
    if (!ok) {
      throw new BadRequestException('当前不可取消（任务已是终态）');
    }

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
    if (!Number.isInteger(seq) || seq < 0) {
      throw new BadRequestException('seq 非法');
    }

    const ok = await this.taskControl.toggleStageGate(parseId(idRaw), seq, body.gate === true);
    if (!ok) {
      throw new BadRequestException('当前不可设置暂停点（环节非待执行）');
    }

    return { ok: true };
  }
}
