import type { Intensity, TriageStatus } from '@hatch-radar/shared';

/** Unix 秒 → 'YYYY-MM-DD HH:mm' */
export function fmtDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Unix 秒 → 相对时间（30 天以上回退绝对日期） */
export function timeAgo(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) {
    return '刚刚';
  }

  if (diff < 3600) {
    return `${Math.floor(diff / 60)} 分钟前`;
  }

  if (diff < 86400) {
    return `${Math.floor(diff / 3600)} 小时前`;
  }

  if (diff < 30 * 86400) {
    return `${Math.floor(diff / 86400)} 天前`;
  }

  return fmtDate(unixSec);
}

/** 版块展示名：Reddit 加 r/ 前缀 */
export function channelLabel(source: string, subreddit: string): string {
  return source === 'reddit' ? `r/${subreddit}` : subreddit;
}

export const INTENSITY_LABELS: Record<Intensity, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

/** 研判状态 → 中文展示名（色值见 src/theme.ts 的 intensity / triage 槽位） */
export const TRIAGE_STATUS_LABELS: Record<TriageStatus, string> = {
  pending: '待研判',
  shortlisted: '已入选',
  archived: '已归档',
};
