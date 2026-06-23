/** 雷达指挥室（radar-lab）—— 展示小工具（相对 sim 时钟取值）。 */
import type { TriggerConfig } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 过去时刻 → "X 分钟前"（相对 sim now）。 */
export function relPast(ms: number, now: number): string {
  const d = now - ms;
  if (d < MIN) {
    return '刚刚';
  }

  if (d < HOUR) {
    return `${Math.floor(d / MIN)} 分钟前`;
  }

  if (d < DAY) {
    return `${Math.floor(d / HOUR)} 小时前`;
  }

  return `${Math.floor(d / DAY)} 天前`;
}

/** 未来时刻 → "X 后"（相对 sim now）。 */
export function relFuture(ms: number, now: number): string {
  const d = ms - now;
  if (d <= 0) {
    return '即将';
  }

  if (d < MIN) {
    return `${Math.ceil(d / 1000)} 秒后`;
  }

  if (d < HOUR) {
    return `${Math.ceil(d / MIN)} 分钟后`;
  }

  return `${Math.ceil(d / HOUR)} 小时后`;
}

/** 时长（ms）→ "Ns" / "Nm Ns"。 */
export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }

  const m = Math.floor(s / 60);
  const r = s % 60;

  return r ? `${m}m ${r}s` : `${m}m`;
}

/** 译文优先取值：preferOriginal 时取原文；否则有译文取译文、无则回退原文。 */
export function tText(original: string, zh: string | undefined, preferOriginal: boolean): string {
  if (preferOriginal) {
    return original;
  }

  return zh && zh.length > 0 ? zh : original;
}

/** 该帖是否已翻译（有标题译文即视为已翻译）。 */
export function isTranslated(p: { titleZh?: string }): boolean {
  return !!(p.titleZh && p.titleZh.length > 0);
}

/** 触发节奏一句话。 */
export function triggerSummary(t: TriggerConfig): string {
  if (t.kind === 'once') {
    return '单次';
  }

  if (t.kind === 'cron') {
    return t.expr;
  }

  const sec = t.everySec;
  if (sec % 3600 === 0) {
    return `每 ${sec / 3600} 小时`;
  }

  return `每 ${Math.round(sec / 60)} 分`;
}
