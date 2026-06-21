import type { TriageStatus } from '@hatch-radar/shared';

/** Unix 秒 → 'YYYY-MM-DD HH:mm'（浏览器本地时区） */
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

/** 秒数 → 紧凑时长，如 '45 秒' / '1 分 23 秒' / '2 时 5 分' */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  return `${Math.floor(s / 3600)} 时 ${Math.floor((s % 3600) / 60)} 分`;
}

/** 版块展示名：Reddit 加 r/ 前缀，其他来源直接用频道名 */
export function channelLabel(source: string, subreddit: string): string {
  return source === 'reddit' ? `r/${subreddit}` : subreddit;
}

const entityCache = new Map<string, string>();
let entityDecoder: HTMLTextAreaElement | null = null;
/**
 * 解码 HTML 实体（如 &#x2F; → /、&amp; → &）。抓取层 decodeHtml 漏解的实体（含已入库旧数据）
 * 在展示层兜底。用 textarea 原生解码——只解实体、不解析标签（RCDATA），不引入 XSS；
 * 按原文记忆化避免重渲染重复解码；无 '&' 时快速返回原串。
 */
export function decodeEntities(text: string): string {
  if (!text || !text.includes('&')) return text;
  const cached = entityCache.get(text);
  if (cached !== undefined) return cached;
  const el = (entityDecoder ??= document.createElement('textarea'));
  el.innerHTML = text;
  const out = el.value;
  entityCache.set(text, out);
  return out;
}

/** permalink → 可点击的完整 URL（Reddit 存的是相对路径） */
export function permalinkUrl(permalink: string): string {
  return permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}`;
}

/** 研判状态 → 中文展示名 */
export const TRIAGE_STATUS_LABELS: Record<TriageStatus, string> = {
  pending: '待研判',
  shortlisted: '已入选',
  archived: '已归档',
};

/** 解析查询串中的页码；非法值回退第 1 页 */
export function parsePage(value: string | undefined | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
