/** 图纸实验室（原型）共享：react-query keys + 展示格式化（page 与 forms 共用，避免环依赖）。 */
import { SOURCE_META } from './constants';
import type { Blueprint, TriggerConfig } from './types';

/** query key 工厂。 */
export const KEYS = {
  blueprints: ['bp', 'blueprints'] as const,
  counts: ['bp', 'counts'] as const,
  /** 全部进程（进程管理页）。 */
  allProcesses: ['bp', 'all-processes'] as const,
  processes: (id: string) => ['bp', 'processes', id] as const,
  /** 某进程运行记录的前缀 key —— 失效时用（前缀匹配，一并清掉该进程的所有页缓存）。 */
  runs: (id: string) => ['bp', 'runs', id] as const,
  /** 某进程某页运行记录（实际查询 key，翻页即换缓存；扩展自 runs 前缀）。 */
  runsPage: (id: string, page: number) => ['bp', 'runs', id, page] as const,
  /** 某进程运行聚合统计（与翻页无关，单独缓存）。 */
  runStats: (id: string) => ['bp', 'run-stats', id] as const,
  /** 单条运行的详情（任务树 + 环节，下钻星图用）。 */
  runDetail: (runId: string) => ['bp', 'run-detail', runId] as const,
};

/** ms 时间戳 → 'YYYY-MM-DD HH:mm'（浏览器本地时区，相对时间的 hover 精确值）。 */
export function absTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相对时间（ms）：未来「… 后」/ 过去「… 前」。 */
export function relTime(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  const label =
    min < 1
      ? '不到 1 分钟'
      : min < 60
        ? `${min} 分钟`
        : abs < 86_400_000
          ? `${Math.round(min / 60)} 小时`
          : `${Math.round(min / 1440)} 天`;
  return diff >= 0 ? `${label}后` : `${label}前`;
}

/** 秒 → 友好周期串（整小时/整分钟优先）。 */
export function everySecLabel(s: number): string {
  if (s % 3600 === 0) return `${s / 3600} 小时`;
  if (s % 60 === 0) return `${s / 60} 分钟`;
  return `${s} 秒`;
}

/** 触发配置 → 一行摘要。 */
export function triggerSummary(t: TriggerConfig): string {
  if (t.kind === 'once') return '单次 · 手动触发';
  if (t.kind === 'interval') return `间隔 · 每 ${everySecLabel(t.everySec)}`;
  return `定时 · ${t.expr}`;
}

/** 图纸源选择 → 一行摘要。 */
export function sourcesSummary(b: Blueprint): string {
  if (b.sources.length === 0) return '未选择来源';
  return b.sources
    .map((s) => {
      const meta = SOURCE_META[s.kind];
      return s.channels.length > 0 ? `${meta.label} ×${s.channels.length}` : meta.label;
    })
    .join(' · ');
}

/** 间隔秒 → { 值, 单位 }（编辑器回填）。 */
export function secondsToInterval(s: number): { value: number; unit: 'min' | 'hour' } {
  if (s % 3600 === 0) return { value: s / 3600, unit: 'hour' };
  return { value: Math.max(1, Math.round(s / 60)), unit: 'min' };
}

/** { 值, 单位 } → 间隔秒。 */
export function intervalToSeconds(value: number, unit: 'min' | 'hour'): number {
  return unit === 'hour' ? value * 3600 : value * 60;
}
