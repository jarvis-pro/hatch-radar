import type { ExportFilter, Intensity } from '@hatch-radar/shared';

/**
 * 解析查询串中的导出 / 批次筛选条件（since / minIntensity / subreddit / limit）；非法值按未提供处理。
 *
 * 导出（export.controller）与翻译覆盖率 / 批量补翻（translations.controller）同口径，故抽出共用，
 * 避免两处各维护一份解析逻辑漂移。
 */
export function parseExportFilter(q: Record<string, string | undefined>): ExportFilter {
  const filter: ExportFilter = {};
  const since = Number(q.since);
  if (Number.isInteger(since) && since > 0) {
    filter.since = since;
  }

  const limit = Number(q.limit);
  if (Number.isInteger(limit) && limit > 0) {
    filter.limit = limit;
  }

  const intensity = q.minIntensity?.toUpperCase();
  if (intensity === 'HIGH' || intensity === 'MEDIUM' || intensity === 'LOW') {
    filter.minIntensity = intensity as Intensity;
  }

  const subreddit = q.subreddit?.trim();
  if (subreddit) {
    filter.subreddit = subreddit;
  }

  return filter;
}
