import type { Intensity } from '@hatch-radar/shared';

/** Unix 秒 → 'YYYY-MM-DD HH:mm'（服务器本地时区） */
export function fmtDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Unix 秒 → 相对时间（30 天以上回退绝对日期） */
export function timeAgo(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 30 * 86400) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDate(unixSec);
}

/** 版块展示名：Reddit 加 r/ 前缀，其他来源直接用频道名 */
export function channelLabel(source: string, subreddit: string): string {
  return source === 'reddit' ? `r/${subreddit}` : subreddit;
}

/** permalink → 可点击的完整 URL（Reddit 存的是相对路径） */
export function permalinkUrl(permalink: string): string {
  return permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}`;
}

const SOURCE_LABELS: Record<string, string> = {
  reddit: 'Reddit',
  hackernews: 'Hacker News',
  rss: 'RSS',
};

/** 来源标识 → 展示名（未知来源原样返回） */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** 强度等级 → 中文展示名 */
export const INTENSITY_LABELS: Record<Intensity, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

/** 解析查询串中的强度筛选；非法值视为未筛选 */
export function parseIntensity(value: string | undefined): Intensity | undefined {
  const upper = value?.toUpperCase();
  return upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW' ? upper : undefined;
}

/** 解析查询串中的页码；非法值回退第 1 页 */
export function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
