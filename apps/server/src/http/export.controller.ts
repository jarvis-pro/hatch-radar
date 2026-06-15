import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get, Header, Query, StreamableFile, UseGuards } from '@nestjs/common';
import type { ExportBatch, ExportFilter, Intensity } from '@hatch-radar/shared';
import { RequireDevicePermission } from '@/auth/device-permission.decorator';
import { DeviceOrSessionGuard } from '@/auth/device-or-session.guard';
import { ExportService, defaultExportName, writeBatchSqlite } from '@hatch-radar/core';
import { logger } from '@/logger';

/** 解析查询串中的批次筛选条件；非法值按未提供处理 */
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
 * /api/export/* —— 局域网导出批次（鉴权）。
 *
 * - GET /api/export/batch          JSON 批次；查询参数 since / minIntensity / subreddit / limit
 * - GET /api/export/batch.sqlite   同条件的独立 .sqlite 文件下载（StreamableFile 流式）
 */
@UseGuards(DeviceOrSessionGuard)
@RequireDevicePermission('export:run')
@Controller('export')
export class ExportController {
  constructor(private readonly exportSvc: ExportService) {}

  @Get('batch')
  async batchJson(@Query() q: Record<string, string | undefined>): Promise<ExportBatch> {
    const batch = await this.exportSvc.collectBatch(parseExportFilter(q));
    logger.info(
      `[导出] HTTP 批次：洞察 ${batch.meta.counts.insights} / 帖子 ${batch.meta.counts.posts} / 评论 ${batch.meta.counts.comments}`,
    );
    return batch;
  }

  @Get('batch.sqlite')
  @Header('Cache-Control', 'no-store')
  async batchSqlite(@Query() q: Record<string, string | undefined>): Promise<StreamableFile> {
    const batch = await this.exportSvc.collectBatch(parseExportFilter(q));
    // 先在临时目录落一个独立 .sqlite，流式发给客户端后清理
    const dir = mkdtempSync(join(tmpdir(), 'hatch-radar-export-'));
    const name = defaultExportName('sqlite');
    const file = writeBatchSqlite(batch, join(dir, name));
    const { size } = statSync(file);
    const stream = createReadStream(file);
    stream.on('close', () => rmSync(dir, { recursive: true, force: true }));
    return new StreamableFile(stream, {
      type: 'application/vnd.sqlite3',
      disposition: `attachment; filename="${name}"`,
      length: size,
    });
  }
}
