import { Controller, Get, Query } from '@nestjs/common';
import type { ExportBatch } from '@hatch-radar/shared';
import { RequirePermission } from '@/common/auth-user.decorator';
import { parseExportFilter } from '@/modules/export/export-query';
import { ExportService } from '@/modules/export/export.service';
import { logger } from '@/logger';

/**
 * /api/export/* —— 导出批次（会话鉴权 + export:run 能力）。
 *
 * - GET /api/export/batch   JSON 批次；查询参数 since / minIntensity / subreddit / limit
 */
@RequirePermission('export:run')
@Controller('export')
export class ExportController {
  constructor(
    // 导出服务：组装并返回导出批次
    private readonly exportSvc: ExportService,
  ) {}

  @Get('batch')
  async batchJson(@Query() q: Record<string, string | undefined>): Promise<ExportBatch> {
    const batch = await this.exportSvc.collectBatch(parseExportFilter(q));
    logger.info(
      `[导出] HTTP 批次：洞察 ${batch.meta.counts.insights} / 帖子 ${batch.meta.counts.posts} / 评论 ${batch.meta.counts.comments}`,
    );

    return batch;
  }
}
