import { createReadStream, mkdtempSync, type ReadStream, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get, Inject, Query, UseGuard } from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
import { defaultExportName, writeBatchSqlite, type ExportService } from '@hatch-radar/core';
import type { ExportBatch, ExportFilter, Intensity } from '@hatch-radar/shared';
import { DeviceOrSessionGuard } from '@/auth/device-or-session.guard';
import { RequireDevicePermission } from '@/auth/device-permission.decorator';
import { TOK } from '@/common/tokens';
import { logger } from '@/logger';

/** 解析查询串中的批次筛选条件；非法值按未提供处理（与 NestJS 版逐字一致）。 */
function parseExportFilter(q: Record<string, string | undefined>): ExportFilter {
  const filter: ExportFilter = {};
  const since = Number(q.since);
  if (Number.isInteger(since) && since > 0) filter.since = since;
  const limit = Number(q.limit);
  if (Number.isInteger(limit) && limit > 0) filter.limit = limit;
  const intensity = q.minIntensity?.toUpperCase();
  if (intensity === 'HIGH' || intensity === 'MEDIUM' || intensity === 'LOW') {
    filter.minIntensity = intensity as Intensity;
  }
  const subreddit = q.subreddit?.trim();
  if (subreddit) filter.subreddit = subreddit;
  return filter;
}

/**
 * /api/export/* —— 局域网导出批次（双通道守卫，需 export:run）。
 * - GET /api/export/batch          JSON 批次
 * - GET /api/export/batch.sqlite   同条件 .sqlite 文件下载（流式；对应 NestJS 版 StreamableFile）
 */
@UseGuard(DeviceOrSessionGuard)
@RequireDevicePermission('export:run')
@Controller('/export')
export class ExportController {
  @Inject(TOK.export)
  exportSvc!: ExportService;

  @Inject()
  ctx!: Context;

  @Get('/batch')
  async batchJson(@Query() q: Record<string, string | undefined>): Promise<ExportBatch> {
    const batch = await this.exportSvc.collectBatch(parseExportFilter(q));
    logger.info(
      `[导出] HTTP 批次：洞察 ${batch.meta.counts.insights} / 帖子 ${batch.meta.counts.posts} / 评论 ${batch.meta.counts.comments}`,
    );
    return batch;
  }

  @Get('/batch.sqlite')
  async batchSqlite(@Query() q: Record<string, string | undefined>): Promise<ReadStream> {
    const batch = await this.exportSvc.collectBatch(parseExportFilter(q));
    // 先在临时目录落一个独立 .sqlite，流式发给客户端后清理
    const dir = mkdtempSync(join(tmpdir(), 'hatch-radar-export-'));
    const name = defaultExportName('sqlite');
    const file = writeBatchSqlite(batch, join(dir, name));
    const { size } = statSync(file);
    const stream = createReadStream(file);
    stream.on('close', () => rmSync(dir, { recursive: true, force: true }));
    // 对应 NestJS 版 @Header + StreamableFile 的 type/disposition/length
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.set('Content-Type', 'application/vnd.sqlite3');
    this.ctx.set('Content-Disposition', `attachment; filename="${name}"`);
    this.ctx.set('Content-Length', String(size));
    return stream;
  }
}
