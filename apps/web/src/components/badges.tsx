import type { Intensity, TriageStatus } from '@hatch-radar/shared';
import { CircleCheck, Clock } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { cn } from '@hatch-radar/ui/lib/utils';
import { INTENSITY_LABELS, sourceLabel, TRIAGE_STATUS_LABELS } from '@/lib/format';

/**
 * 强度语义底色：neutral 主题不含「高/中/低」三级色，
 * 这里用 Tailwind 调色板的柔和底色经由 Badge 组件呈现（不写自定义 CSS / 变量）。
 */
const INTENSITY_CLASS: Record<Intensity, string> = {
  HIGH: 'border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  MEDIUM: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  LOW: 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

/** 痛点强度徽标（高/中/低，颜色随强度） */
export function IntensityBadge({
  intensity,
  className,
}: {
  intensity: Intensity;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(INTENSITY_CLASS[intensity], className)}>
      {INTENSITY_LABELS[intensity]}强度
    </Badge>
  );
}

/** 数据来源徽标（Reddit / Hacker News / RSS） */
export function SourceBadge({ source }: { source: string }) {
  return <Badge variant="secondary">{sourceLabel(source)}</Badge>;
}

/** 帖子分析状态徽标 */
export function AnalyzedBadge({ analyzedAt }: { analyzedAt: number | null }) {
  return analyzedAt ? (
    <Badge variant="secondary">
      <CircleCheck />
      已分析
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      <Clock />
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
