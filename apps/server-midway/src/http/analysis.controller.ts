import { Controller, Get, HttpCode, httpError, Inject, Post, UseGuard } from '@midwayjs/core';
import { z } from 'zod';
import {
  type AnalysisConfigService,
  type JobsRepository,
  type ProvidersRepository,
  type SettingsRepository,
} from '@hatch-radar/core';
import { RequirePermission } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { ValidBody } from '@/common/params';
import { TOK } from '@/common/tokens';
import { logger } from '@/logger';

const runSchema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(500),
  providerId: z.number().int(),
});

/**
 * /api/analysis/* —— 手动运行入队 + 队列看板（鉴权，需 analyze:run）。
 * POST /run 由 NestJS 版 @HttpCode(200) 固定为 200。
 */
@UseGuard(SessionAuthGuard)
@RequirePermission('analyze:run')
@Controller('/analysis')
export class AnalysisController {
  @Inject(TOK.analysisConfig)
  analysisConfig!: AnalysisConfigService;

  @Inject(TOK.jobs)
  jobs!: JobsRepository;

  @Inject(TOK.providers)
  providers!: ProvidersRepository;

  @Inject(TOK.settings)
  settings!: SettingsRepository;

  @Post('/run')
  @HttpCode(200)
  async run(@ValidBody(runSchema) dto: z.infer<typeof runSchema>) {
    const result = await this.analysisConfig.enqueueManualRun(dto.postIds, dto.providerId);
    if (!result.ok) throw new httpError.BadRequestError(result.error ?? '运行失败');
    logger.info(`[手动运行] 入队 ${result.enqueued} 篇（provider#${dto.providerId}）`);
    return { enqueued: result.enqueued };
  }

  @Get('/jobs')
  async jobsView() {
    return { stats: await this.jobs.getJobStats(), jobs: await this.jobs.listRecentJobs(50) };
  }

  /** 分析页模型下拉：仅启用模型的 { id, label } + 当前 active（不含任何密钥）。 */
  @Get('/providers')
  async providerOptions() {
    const list = await this.providers.listProviders();
    return {
      providers: list.filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.label })),
      activeProviderId: await this.settings.getActiveProviderId(),
    };
  }
}
