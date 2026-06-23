import { PageHeading } from '@/components/section';
import { ScrollScaleItem } from '@/components/scroll-reveal';
import { Text } from '@/components/ui/text';
import type { Opportunity } from '@/data/types';
import { compact, INTENSITY_META, momentumLabel } from '@/lib/format';
import { hapticSelect } from '@/lib/haptics';
import { useStore } from '@/lib/store';
import { INTENSITY_GLOW, usePalette } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const pad = (n: number) => String(n).padStart(2, '0');

function SavedRow({ op, index, onPress }: { op: Opportunity; index: number; onPress: () => void }) {
  const palette = usePalette();
  const hue = INTENSITY_GLOW[op.intensity];
  const up = op.momentum >= 0;
  return (
    <Pressable onPress={onPress} className="px-7 py-6" style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairlineSoft }}>
      <View className="mb-3 flex-row items-center gap-3">
        <Text style={{ color: hue }} className="font-mono-sb text-[13px]">
          {pad(index)}
        </Text>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hue }} />
        <Text style={{ color: hue }} className="text-[12px] font-sans-sb">
          {INTENSITY_META[op.intensity].label}
        </Text>
        <Text className="text-[12px] font-sans-md uppercase tracking-wider text-muted-foreground">· {op.category}</Text>
        <View className="flex-1" />
        <Text style={{ color: hue }} className="font-mono-sb text-[24px] leading-[1.3]">
          {op.score}
        </Text>
      </View>
      <Text className="text-[23px] font-sans-bd leading-[1.3] text-foreground" numberOfLines={2}>
        {op.title}
      </Text>
      <Text className="mt-3 font-mono text-[12px] text-muted-foreground">
        {op.channel} · 声量 {compact(op.mentions)} · {momentumLabel(op.momentum)}
        {up ? ' ↑' : ' ↓'}
      </Text>
    </Pressable>
  );
}

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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

  const open = (op: Opportunity) => {
    hapticSelect();
    router.push(`/opportunity/${op.id}`);
  };

  return (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 120 }}
    >
      <PageHeading eyebrow="收藏" title="灵感板" subtitle="你筛选出的高潜力产品机会" />

      {stats.count > 0 ? (
        <View className="mb-8 mt-3 flex-row items-center gap-6 px-7">
          <Text className="text-[13px] text-muted-foreground">
            <Text className="font-mono-sb text-[15px] text-foreground">{stats.count}</Text> 收藏
          </Text>
          <Text className="text-[13px] text-muted-foreground">
            <Text className="font-mono-sb text-[15px] text-foreground">{stats.avg}</Text> 均分
          </Text>
          <Text className="text-[13px] text-muted-foreground">
            <Text className="font-mono-sb text-[15px] text-foreground">{stats.high}</Text> 强信号
          </Text>
        </View>
      ) : null}

      {stats.count === 0 ? (
        <View className="px-7 pt-16 items-center">
          <Text className="text-[44px] font-sans-bd text-foreground" style={{ opacity: 0.12 }}>
            ∅
          </Text>
          <Text className="mt-4 text-center text-[15px] leading-7 text-muted-foreground">
            还没有收藏。{'\n'}在雷达滑动浏览，或到「探索」右滑卡片，{'\n'}把心动的机会收进灵感板。
          </Text>
        </View>
      ) : (
        savedOpportunities.map((op, i) => (
          <ScrollScaleItem key={op.id} scrollY={scrollY} viewportH={height}>
            <SavedRow op={op} index={i + 1} onPress={() => open(op)} />
          </ScrollScaleItem>
        ))
      )}
    </Animated.ScrollView>
  );
}
