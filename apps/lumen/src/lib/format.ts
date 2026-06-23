import type { Intensity, SourceKind } from '@/data/types';

/** 分钟差 → 相对时间。 */
export function agoLabel(minutes: number): string {
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const h = Math.floor(minutes / 60);
  if (h < 24) {
    return `${h} 小时前`;
  }
  return `${Math.floor(h / 24)} 天前`;
}

/** 紧凑计数：1284 → 1.3k，1200000 → 1.2M。 */
export function compact(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 千分位。 */
export function withCommas(n: number): string {
  return n.toLocaleString('en-US');
}

/** 动量百分比带符号。 */
export function momentumLabel(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}%`;
}

/** 强度元数据（label + 各类 className）。 */
export const INTENSITY_META: Record<
  Intensity,
  { label: string; text: string; bg: string; soft: string; border: string }
> = {
  high: {
    label: '强信号',
    text: 'text-intensity-high',
    bg: 'bg-intensity-high',
    soft: 'bg-intensity-high/15',
    border: 'border-intensity-high/30',
  },
  medium: {
    label: '中信号',
    text: 'text-intensity-medium',
    bg: 'bg-intensity-medium',
    soft: 'bg-intensity-medium/15',
    border: 'border-intensity-medium/30',
  },
  low: {
    label: '弱信号',
    text: 'text-intensity-low',
    bg: 'bg-intensity-low',
    soft: 'bg-intensity-low/15',
    border: 'border-intensity-low/30',
  },
};

/** 来源展示名。 */
export const SOURCE_LABEL: Record<SourceKind, string> = {
  reddit: 'Reddit',
  hackernews: 'Hacker News',
  producthunt: 'Product Hunt',
  github: 'GitHub',
  rss: 'RSS',
};
