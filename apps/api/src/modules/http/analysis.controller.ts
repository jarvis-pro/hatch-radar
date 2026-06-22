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
import { z } from 'zod';
import { RequirePermission } from '@/modules/account/auth-user.decorator';
import { SessionAuthGuard } from '@/modules/account/session-auth.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { ProvidersRepository, SettingsRepository } from '@/database';
import { TaskControlService } from '@/modules/pipeline/task-control.service';
import { logger } from '@/logger';

const inspectSchema = z.object({
  postId: z.string().min(1),
  providerId: z.number().int(),
  /** 逐节点闸门：缺省 true（逐步检视）；false 为运行到底＋留痕 */
  stepGate: z.boolean().optional().default(true),
});

/** 解析并校验路径里的 jobId（正整数）。 */
function parseJobId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('jobId 非法');
  return id;
}

/**
 * /api/analysis/* —— 流水线检视器（鉴权）。
 *
 * - GET  /api/analysis/providers                 流水线检视的模型下拉（启用模型 + active，无密钥）
 * - POST /api/analysis/inspect                   发起检视任务（单条手动触发、逐节点暂停）
 * - GET  /api/analysis/inspect/:jobId            取检视任务视图（任务 + 6 节点轨迹，供前端轮询）
 * - POST /api/analysis/inspect/:jobId/resume     放行下一节点（paused→queued）
 * - POST /api/analysis/inspect/:jobId/run-to-end 运行到底（关闭闸门、续跑剩余节点）
 * - POST /api/analysis/inspect/:jobId/retry-step 重试当前失败节点
 * - POST /api/analysis/inspect/:jobId/cancel     取消检视任务
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('analyze:run')
@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly taskControl: TaskControlService,
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
  ) {}

  /** 模型下拉（流水线检视用）：仅启用模型的 { id, label } + 当前 active（不含任何密钥）。 */
  @Get('providers')
  async providerOptions() {
    const list = await this.providers.listProviders();
    return {
      providers: list.filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.label })),
      activeProviderId: await this.settings.getActiveProviderId(),
    };
  }

  // ─── 流水线检视器 ─────────────────────────────────────────────────────────────────

  /** 发起检视任务：建 inspect job + 6 个 pending 节点 + 派发。该帖已有活跃分析任务时 400（服务抛 DomainError）。 */
  @Post('inspect')
  @HttpCode(200)
  async inspect(@Body(new ZodValidationPipe(inspectSchema)) dto: z.infer<typeof inspectSchema>) {
    const { taskId } = await this.taskControl.enqueueInspect(
      dto.postId,
      dto.providerId,
      dto.stepGate,
    );
    logger.info(
      `[检视] 发起 task#${taskId}（post=${dto.postId} provider#${dto.providerId} gate=${dto.stepGate}）`,
    );
    return { jobId: taskId };
  }

  /** 取检视任务视图（任务 + 6 节点轨迹，含产物）。前端轮询此端点。 */
  @Get('inspect/:jobId')
  async inspectView(@Param('jobId') jobIdRaw: string) {
    const view = await this.taskControl.getInspectView(parseJobId(jobIdRaw));
    if (!view) throw new NotFoundException('检视任务不存在');
    return view;
  }

  /** 放行下一节点：paused→queued + 派发。 */
  @Post('inspect/:jobId/resume')
  @HttpCode(200)
  async inspectResume(@Param('jobId') jobIdRaw: string) {
    const ok = await this.taskControl.resumeInspect(parseJobId(jobIdRaw));
    if (!ok) throw new BadRequestException('当前不可放行（任务并非暂停态）');
    return { ok: true };
  }

  /** 运行到底：关闭逐节点闸门，连续跑完剩余节点（仍留轨迹）。 */
  @Post('inspect/:jobId/run-to-end')
  @HttpCode(200)
  async inspectRunToEnd(@Param('jobId') jobIdRaw: string) {
    await this.taskControl.runInspectToEnd(parseJobId(jobIdRaw));
    return { ok: true };
  }

  /** 重试当前失败节点：复位该 step 回 pending、job failed→queued + 派发。不可重试时 400（服务抛 DomainError）。 */
  @Post('inspect/:jobId/retry-step')
  @HttpCode(200)
  async inspectRetryStep(@Param('jobId') jobIdRaw: string) {
    await this.taskControl.retryInspectStep(parseJobId(jobIdRaw));
    return { ok: true };
  }

  /** 取消检视任务（释放闸门、停止演示）。 */
  @Post('inspect/:jobId/cancel')
  @HttpCode(200)
  async inspectCancel(@Param('jobId') jobIdRaw: string) {
    const ok = await this.taskControl.cancelInspect(parseJobId(jobIdRaw));
    if (!ok) throw new BadRequestException('当前不可取消（任务已是终态）');
    return { ok: true };
  }
}
