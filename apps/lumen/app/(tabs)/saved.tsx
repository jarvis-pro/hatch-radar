import { Appear } from '@/components/appear';
import { GlassCard } from '@/components/glass';
import { OpportunityCard } from '@/components/opportunity-card';
import { ScrollScaleItem } from '@/components/scroll-reveal';
import { PageHeading } from '@/components/section';
import { StatTile } from '@/components/stat-tile';
import { Text } from '@/components/ui/text';
import { useStore } from '@/lib/store';
import { usePalette } from '@/lib/theme';
import { Bookmark, Flame, Gauge, Sparkles } from 'lucide-react-native';
import { useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { height } = useWindowDimensions();
  const { savedOpportunities } = useStore();

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const stats = useMemo(() => {
    const count = savedOpportunities.length;
    const avg = count ? Math.round(savedOpportunities.reduce((s, o) => s + o.score, 0) / count) : 0;
    const high = savedOpportunities.filter((o) => o.intensity === 'high').length;
    return { count, avg, high };
  }, [savedOpportunities]);

  return (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 120 }}
    >
      <PageHeading eyebrow="收藏" title="灵感板" subtitle="你筛选出的高潜力产品机会" />

      {stats.count > 0 ? (
        <Appear delay={60} className="mt-3 flex-row gap-3 px-5">
          <StatTile icon={Bookmark} label="已收藏" value={stats.count} accent={palette.primary} delay={150} />
          <StatTile icon={Gauge} label="平均机会分" value={stats.avg} accent={palette.signal} delay={250} />
          <StatTile icon={Flame} label="强信号" value={stats.high} accent={palette.intensityHigh} delay={350} />
        </Appear>
      ) : null}

      {stats.count === 0 ? (
        <Appear from="none" className="px-5 pt-6">
          <GlassCard className="items-center rounded-[28px] p-8">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/12">
              <Sparkles size={28} color={palette.primary} strokeWidth={2.3} />
            </View>
            <Text className="mt-5 text-lg font-sans-bd text-foreground">还没有收藏</Text>
            <Text className="mt-2 text-center text-[13px] leading-5 text-muted-foreground">
              在雷达点开光点，或到「探索」右滑卡片，{'\n'}把心动的机会收进灵感板。
            </Text>
          </GlassCard>
        </Appear>
      ) : (
        savedOpportunities.map((op, i) => (
          <ScrollScaleItem
            key={op.id}
            scrollY={scrollY}
            viewportH={height}
            className="px-5"
            style={{ marginTop: i === 0 ? 10 : 14 }}
          >
            <OpportunityCard op={op} />
          </ScrollScaleItem>
        ))
      )}
    </Animated.ScrollView>
  );
}
