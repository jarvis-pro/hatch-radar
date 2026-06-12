import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { INTENSITY_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Intensity } from '@hatch-radar/shared';

/** 强度 → 柔和底色 + 语义前景色（HIGH=destructive / MEDIUM=warning / LOW=success） */
const BADGE_CLASS: Record<Intensity, { box: string; text: string }> = {
  HIGH: { box: 'border-destructive/20 bg-destructive/10', text: 'text-destructive' },
  MEDIUM: { box: 'border-warning/20 bg-warning/10', text: 'text-warning' },
  LOW: { box: 'border-success/20 bg-success/10', text: 'text-success' },
};

export function IntensityBadge({ intensity }: { intensity: Intensity }) {
  const c = BADGE_CLASS[intensity];

  return (
    <Badge variant="outline" className={c.box}>
      <Text className={cn('text-xs font-medium', c.text)}>{INTENSITY_LABELS[intensity]}强度</Text>
    </Badge>
  );
}
