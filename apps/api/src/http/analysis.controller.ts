import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import {
  AnalysisConfigService,
  type JobStatus,
  type JobTrigger,
  JobsRepository,
  parsePage,
  ProvidersRepository,
  SettingsRepository,
} from '@/domain';
import { logger } from '@/logger';

const runSchema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(500),
  providerId: z.number().int(),
});

const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
const JOB_TRIGGERS = ['auto', 'manual'] as const;

/**
 * /api/analysis/* —— 手动运行入队 + 队列看板（鉴权）。
 *
 * - POST /api/analysis/run        手动运行：选中帖子按指定模型入队（trigger=manual）
 * - GET  /api/analysis/jobs       队列看板：各状态汇总 + 最近任务（供 web 轮询）
 * - GET  /api/analysis/providers  分析页模型下拉（启用模型 + active，无密钥；analyze:run 即可见）
 */
@UseGuards(SessionAuthGuard)
@RequirePermission('analyze:run')
@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly analysisConfig: AnalysisConfigService,
    private readonly jobs: JobsRepository,
    private readonly providers: ProvidersRepository,
    private readonly settings: SettingsRepository,
  ) {}

  @Post('run')
  @HttpCode(200)
  async run(@Body(new ZodValidationPipe(runSchema)) dto: z.infer<typeof runSchema>) {
    const result = await this.analysisConfig.enqueueManualRun(dto.postIds, dto.providerId);
    // 业务失败（模型不存在 / 已停用）统一抛异常交全局过滤器（{ error } 400），与其它写端点一致
    if (!result.ok) throw new BadRequestException(result.error ?? '运行失败');
    logger.info(`[手动运行] 入队 ${result.enqueued} 篇（provider#${dto.providerId}）`);
    return { enqueued: result.enqueued };
  }

  @Get('jobs')
  async jobsView() {
    return { stats: await this.jobs.getJobStats(), jobs: await this.jobs.listRecentJobs(50) };
  }

  /** 队列分页 + 分类筛选（status / trigger）；附状态汇总供筛选标签计数。供「队列」页全宽表格。 */
  @Get('jobs/list')
  async jobsList(@Query() q: Record<string, string | undefined>) {
    const status = (JOB_STATUSES as readonly string[]).includes(q.status ?? '')
      ? (q.status as JobStatus)
      : undefined;
    const trigger = (JOB_TRIGGERS as readonly string[]).includes(q.trigger ?? '')
      ? (q.trigger as JobTrigger)
      : undefined;
    const [stats, page] = await Promise.all([
      this.jobs.getJobStats(),
      this.jobs.listJobsPaged({ status, trigger }, parsePage(q.page)),
    ]);
    return { stats, ...page };
  }

  /** 分析页模型下拉：仅启用模型的 { id, label } + 当前 active（不含任何密钥）。 */
  @Get('providers')
  async providerOptions() {
    const list = await this.providers.listProviders();
    return {
      providers: list.filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.label })),
      activeProviderId: await this.settings.getActiveProviderId(),
    };
  }
}
