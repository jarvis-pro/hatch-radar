import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { INTENSITY_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Intensity } from '@hatch-radar/shared';
import { View } from 'react-native';

/** 强度 → 语义强度色（全站统一，对齐 Web：HIGH 红 / MEDIUM 琥珀 / LOW 翠）。 */
const INTENSITY_PILL: Record<Intensity, string> = {
  HIGH: 'border-intensity-high/30 bg-intensity-high/12',
  MEDIUM: 'border-intensity-medium/30 bg-intensity-medium/12',
  LOW: 'border-intensity-low/30 bg-intensity-low/12',
};

const INTENSITY_TEXT: Record<Intensity, string> = {
  HIGH: 'text-intensity-high',
  MEDIUM: 'text-intensity-medium',
  LOW: 'text-intensity-low',
};

/** 实心色条/点（洞察卡左条、强度分布）用 */
export const INTENSITY_BAR: Record<Intensity, string> = {
  HIGH: 'bg-intensity-high',
  MEDIUM: 'bg-intensity-medium',
  LOW: 'bg-intensity-low',
};

export function IntensityDot({
  intensity,
  className,
}: {
  intensity: Intensity;
  className?: string;
}) {
  return <View className={cn('h-1.5 w-1.5 rounded-full', INTENSITY_BAR[intensity], className)} />;
}

export function IntensityBadge({ intensity }: { intensity: Intensity }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5', INTENSITY_PILL[intensity])}>
      <IntensityDot intensity={intensity} />
      <Text className={cn('text-xs font-sans-md', INTENSITY_TEXT[intensity])}>
        {INTENSITY_LABELS[intensity]}强度
      </Text>
    </Badge>
  );
}
