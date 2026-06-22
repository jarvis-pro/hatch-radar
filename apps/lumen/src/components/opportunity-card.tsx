import { GlassCard } from '@/components/glass';
import { IntensityPill } from '@/components/intensity';
import { PressableScale } from '@/components/pressable-scale';
import { SaveButton } from '@/components/save-button';
import { Text } from '@/components/ui/text';
import type { Opportunity } from '@/data/types';
import { agoLabel, compact, momentumLabel } from '@/lib/format';
import { usePalette } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { View } from 'react-native';

/** 机会卡：雷达情报流 / 收藏页复用。整卡可点进详情，右上角独立收藏键。 */
export function OpportunityCard({ op }: { op: Opportunity }) {
  const router = useRouter();
  const palette = usePalette();
  const up = op.momentum >= 0;
  const trendColor = up ? palette.intensityLow : palette.mutedForeground;

  return (
    <PressableScale scaleTo={0.975} onPress={() => router.push(`/opportunity/${op.id}`)}>
      <GlassCard className="rounded-[26px] p-5">
        <View className="flex-row items-start justify-between">
          <IntensityPill intensity={op.intensity} />
          <SaveButton id={op.id} />
        </View>

        <Text className="mt-3.5 text-[17px] font-sans-sb leading-snug text-foreground" numberOfLines={2}>
          {op.title}
        </Text>
        <Text className="mt-2 text-[13.5px] leading-5 text-muted-foreground" numberOfLines={2}>
          {op.pitch}
        </Text>

        <View className="mt-4 flex-row items-center gap-4">
          <View className="flex-row items-baseline gap-1">
            <Text className="font-mono-sb text-2xl text-primary">{op.score}</Text>
            <Text className="text-[11px] text-muted-foreground">机会分</Text>
          </View>
          <View className="h-5 w-px bg-white/10" />
          <View className="flex-row items-center gap-1">
            {up ? (
              <TrendingUp size={14} color={trendColor} strokeWidth={2.4} />
            ) : (
              <TrendingDown size={14} color={trendColor} strokeWidth={2.4} />
            )}
            <Text className={`font-mono-sb text-sm ${up ? 'text-intensity-low' : 'text-muted-foreground'}`}>
              {momentumLabel(op.momentum)}
            </Text>
          </View>
        </View>

        <Text className="mt-3 font-mono text-[11px] text-muted-foreground" numberOfLines={1}>
          {op.channel} · 声量 {compact(op.mentions)} · {op.communities} 社区 · {agoLabel(op.ageMinutes)}
        </Text>

        <View className="mt-3 flex-row flex-wrap gap-1.5">
          {op.tags.slice(0, 4).map((t) => (
            <View key={t} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
              <Text className="text-[11px] font-sans-md text-muted-foreground">#{t}</Text>
            </View>
          ))}
        </View>
      </GlassCard>
    </PressableScale>
  );
}
