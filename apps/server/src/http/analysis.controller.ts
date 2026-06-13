import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AnalysisConfigService } from '../analysis/analysis-config.service';
import { BearerAuthGuard } from '../common/bearer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JobsRepository } from '../db/jobs.repository';
import { logger } from '../logger';

const runSchema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(500),
  providerId: z.number().int(),
});

/**
 * /api/analysis/* —— 手动运行入队 + 队列看板（鉴权）。
 *
 * - POST /api/analysis/run    手动运行：选中帖子按指定模型入队（trigger=manual）
 * - GET  /api/analysis/jobs   队列看板：各状态汇总 + 最近任务（供 web 轮询）
 */
@UseGuards(BearerAuthGuard)
@Controller('api/analysis')
export class AnalysisController {
  constructor(
    private readonly analysisConfig: AnalysisConfigService,
    private readonly jobs: JobsRepository,
  ) {}

  @Post('run')
  @HttpCode(200)
  async run(
    @Body(new ZodValidationPipe(runSchema)) dto: z.infer<typeof runSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.analysisConfig.enqueueManualRun(dto.postIds, dto.providerId);
    if (!result.ok) {
      res.status(400);
      return result;
    }
    logger.info(`[手动运行] 入队 ${result.enqueued} 篇（provider#${dto.providerId}）`);
    return result;
  }

  @Get('jobs')
  async jobsView() {
    return { stats: await this.jobs.getJobStats(), jobs: await this.jobs.listRecentJobs(50) };
  }
}
