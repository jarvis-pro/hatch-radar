import type { Intensity } from '@hatch-radar/shared';
import { INTENSITY_LABELS, sourceLabel } from '@/lib/format';

/** 痛点强度徽标（高/中/低，颜色随强度） */
export function IntensityBadge({ intensity }: { intensity: Intensity }) {
  return (
    <span className={`badge intensity-${intensity.toLowerCase()}`}>
      {INTENSITY_LABELS[intensity]}强度
    </span>
  );
}

/** 数据来源徽标（Reddit / Hacker News / RSS） */
export function SourceBadge({ source }: { source: string }) {
  return <span className={`badge source-${source}`}>{sourceLabel(source)}</span>;
}

/** 帖子分析状态徽标 */
export function AnalyzedBadge({ analyzedAt }: { analyzedAt: number | null }) {
  return analyzedAt ? (
    <span className="badge status-analyzed">已分析</span>
  ) : (
    <span className="badge status-pending">待分析</span>
  );
}
