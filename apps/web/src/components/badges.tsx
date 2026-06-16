import type { Intensity, TriageStatus } from '@hatch-radar/shared';
import { CircleCheck, Clock } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { cn } from '@hatch-radar/ui/lib/utils';
import { INTENSITY_LABELS, sourceLabel, TRIAGE_STATUS_LABELS } from '@/lib/format';

/** 强度 → pill 配色（语义强度 token，全站统一：红/琥珀/翠绿）。 */
const INTENSITY_PILL: Record<Intensity, string> = {
  HIGH: 'border-intensity-high/30 bg-intensity-high/12 text-intensity-high',
  MEDIUM: 'border-intensity-medium/30 bg-intensity-medium/12 text-intensity-medium',
  LOW: 'border-intensity-low/30 bg-intensity-low/12 text-intensity-low',
};

/** 强度 → 实色背景（列表左色条 / 圆点 / 占比条共用）。 */
export const INTENSITY_BAR: Record<Intensity, string> = {
  HIGH: 'bg-intensity-high',
  MEDIUM: 'bg-intensity-medium',
  LOW: 'bg-intensity-low',
};

/** 强度 → 左边框色（详情页痛点卡左缘）。 */
export const INTENSITY_BORDER_L: Record<Intensity, string> = {
  HIGH: 'border-l-intensity-high',
  MEDIUM: 'border-l-intensity-medium',
  LOW: 'border-l-intensity-low',
};

/** 强度小圆点（信号感的最小单元）。 */
export function IntensityDot({
  intensity,
  className,
}: {
  intensity: Intensity;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-1.5 rounded-full', INTENSITY_BAR[intensity], className)}
    />
  );
}

/** 痛点强度徽标（高/中/低，语义色 + 圆点） */
export function IntensityBadge({
  intensity,
  className,
}: {
  intensity: Intensity;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-medium', INTENSITY_PILL[intensity], className)}
    >
      <IntensityDot intensity={intensity} />
      {INTENSITY_LABELS[intensity]}强度
    </Badge>
  );
}

/** 来源平台 → 标识点色（克制的平台识别：Reddit/HN 橙、RSS 琥珀）。 */
const SOURCE_DOT: Record<string, string> = {
  reddit: 'bg-orange-500',
  hackernews: 'bg-orange-400',
  rss: 'bg-amber-500',
};

/** 数据来源徽标（Reddit / Hacker News / RSS，带平台色点） */
export function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', SOURCE_DOT[source] ?? 'bg-muted-foreground')} />
      {sourceLabel(source)}
    </Badge>
  );
}

/** 帖子分析状态徽标 */
export function AnalyzedBadge({ analyzedAt }: { analyzedAt: number | null }) {
  return analyzedAt ? (
    <Badge
      variant="outline"
      className="gap-1 border-intensity-low/30 bg-intensity-low/12 font-normal text-intensity-low"
    >
      <CircleCheck className="size-3.5" />
      已分析
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
      <Clock className="size-3.5" />
      待分析
    </Badge>
  );
}

const TRIAGE_VARIANT: Record<TriageStatus, 'default' | 'secondary' | 'outline'> = {
  shortlisted: 'default',
  pending: 'outline',
  archived: 'secondary',
};

/** 人工研判状态徽标（待研判 / 已入选 / 已归档） */
export function TriageStatusBadge({ status }: { status: TriageStatus }) {
  return (
    <Badge
      variant={TRIAGE_VARIANT[status]}
      className={status === 'pending' ? 'text-muted-foreground' : undefined}
    >
      {TRIAGE_STATUS_LABELS[status]}
    </Badge>
  );
}
