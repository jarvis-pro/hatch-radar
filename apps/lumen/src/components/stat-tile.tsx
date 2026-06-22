import { AnimatedNumber } from '@/components/animated-number';
import { GlassCard } from '@/components/glass';
import { Text } from '@/components/ui/text';
import { usePalette } from '@/lib/theme';
import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

/** 统计磁贴：玻璃面 + 图标 + 滚动数值 + 标签。首页脉冲 / 收藏 / 我的页复用。 */
export function StatTile({
  icon: Icon,
  label,
  value,
  format = 'int',
  suffix,
  accent,
  delay = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  format?: 'int' | 'compact';
  suffix?: string;
  accent?: string;
  delay?: number;
}) {
  const palette = usePalette();
  return (
    <GlassCard className="flex-1 rounded-3xl p-4">
      <View className="h-7 w-7 items-center justify-center rounded-xl bg-white/5">
        <Icon size={16} color={accent ?? palette.signal} strokeWidth={2.2} />
      </View>
      <AnimatedNumber
        value={value}
        format={format}
        suffix={suffix}
        delay={delay}
        className="mt-2.5 font-mono-sb text-[22px] text-foreground"
      />
      <Text className="mt-0.5 text-[11px] text-muted-foreground">{label}</Text>
    </GlassCard>
  );
}
