import { GlassCard } from '@/components/glass';
import { IntensityPill } from '@/components/intensity';
import { Text } from '@/components/ui/text';
import type { Opportunity } from '@/data/types';
import { momentumLabel } from '@/lib/format';
import { hapticSelect } from '@/lib/haptics';
import { INTENSITY_GLOW, usePalette } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

const SPACING = 14;
const CARD_H = 400;

/** 聚焦卡驱动的背景径向光晕：随 scrollX 在相邻项间交叉淡入（Apple-Invites 模式）。 */
function Glow({ index, scrollX, snap, color }: { index: number; scrollX: SharedValue<number>; snap: number; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollX.value,
      [(index - 1) * snap, index * snap, (index + 1) * snap],
      [0, 1, 0],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`glow-${index}`} cx="50%" cy="34%" r="62%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <Stop offset="60%" stopColor={color} stopOpacity={0.16} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#glow-${index})`} />
      </Svg>
    </Animated.View>
  );
}

/** 轮播卡：随与中心的距离缩放 / 下沉 / 降透明，内容横向视差。 */
function CarouselCard({
  op,
  index,
  scrollX,
  snap,
  itemW,
  onPress,
}: {
  op: Opportunity;
  index: number;
  scrollX: SharedValue<number>;
  snap: number;
  itemW: number;
  onPress: () => void;
}) {
  const palette = usePalette();
  const up = op.momentum >= 0;

  const cardStyle = useAnimatedStyle(() => {
    const d = Math.abs(scrollX.value - index * snap);
    return {
      transform: [
        { scale: interpolate(d, [0, snap], [1, 0.88], Extrapolation.CLAMP) },
        { translateY: interpolate(d, [0, snap], [0, 24], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(d, [0, snap], [1, 0.5], Extrapolation.CLAMP),
    };
  });
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(scrollX.value - index * snap, [-snap, snap], [28, -28], Extrapolation.CLAMP) }],
  }));

  return (
    <Pressable onPress={onPress} style={{ width: itemW }}>
      <Animated.View style={cardStyle}>
        <GlassCard tone="strong" className="rounded-[30px] p-6" style={{ height: CARD_H }}>
          <View className="flex-row items-center justify-between">
            <IntensityPill intensity={op.intensity} />
            <Text className="font-mono text-xs text-muted-foreground">{op.channel}</Text>
          </View>

          <Animated.View style={innerStyle} className="mt-5">
            <Text className="text-[26px] font-sans-bd leading-tight text-foreground" numberOfLines={2}>
              {op.title}
            </Text>
            <Text className="mt-3 text-[14px] leading-6 text-muted-foreground" numberOfLines={3}>
              {op.pitch}
            </Text>
            <View className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3.5">
              <Text className="text-[10px] font-sans-sb uppercase tracking-wider text-primary">核心痛点</Text>
              <Text className="mt-1.5 text-[13px] leading-5 text-foreground" numberOfLines={2}>
                “{op.painPoints[0].text}”
              </Text>
            </View>
            <View className="mt-3 flex-row flex-wrap gap-1.5">
              {op.tags.slice(0, 3).map((t) => (
                <View key={t} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  <Text className="text-[11px] font-sans-md text-muted-foreground">#{t}</Text>
                </View>
              ))}
            </View>
          </Animated.View>

          <View className="flex-row items-end justify-between" style={{ marginTop: 'auto' }}>
            <View className="flex-row items-baseline gap-1.5">
              <Text className="font-mono-sb text-5xl text-primary">{op.score}</Text>
              <Text className="mb-1.5 text-xs text-muted-foreground">机会分</Text>
            </View>
            <View className="flex-row items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              {up ? (
                <TrendingUp size={14} color={palette.intensityLow} strokeWidth={2.4} />
              ) : (
                <TrendingDown size={14} color={palette.mutedForeground} strokeWidth={2.4} />
              )}
              <Text className={`font-mono-sb text-sm ${up ? 'text-intensity-low' : 'text-muted-foreground'}`}>
                {momentumLabel(op.momentum)}
              </Text>
            </View>
          </View>
        </GlassCard>
      </Animated.View>
    </Pressable>
  );
}

/** 分页点：聚焦项加宽 + 提亮。 */
function Dot({ index, scrollX, snap }: { index: number; scrollX: SharedValue<number>; snap: number }) {
  const palette = usePalette();
  const style = useAnimatedStyle(() => {
    const d = Math.abs(scrollX.value - index * snap);
    return {
      width: interpolate(d, [0, snap], [22, 7], Extrapolation.CLAMP),
      opacity: interpolate(d, [0, snap], [1, 0.32], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[{ height: 7, borderRadius: 4, backgroundColor: palette.primary }, style]} />;
}

/**
 * 机会视差轮播（首页主秀）：横向分页、聚焦卡驱动背景光晕交叉淡入、卡片缩放下沉、内容视差。
 * 参考 animatereactnative 的 Parallax Carousel / Apple Invites 招牌模式。
 */
export function OpportunityCarousel({ items }: { items: Opportunity[] }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const itemW = Math.min(width * 0.76, 320);
  const snap = itemW + SPACING;
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  return (
    <View>
      <View style={[StyleSheet.absoluteFill, { height: CARD_H + 40 }]} pointerEvents="none">
        {items.map((op, i) => (
          <Glow key={op.id} index={i} scrollX={scrollX} snap={snap} color={INTENSITY_GLOW[op.intensity]} />
        ))}
      </View>

      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: (width - itemW) / 2, gap: SPACING, paddingVertical: 8 }}
      >
        {items.map((op, i) => (
          <CarouselCard
            key={op.id}
            op={op}
            index={i}
            scrollX={scrollX}
            snap={snap}
            itemW={itemW}
            onPress={() => {
              hapticSelect();
              router.push(`/opportunity/${op.id}`);
            }}
          />
        ))}
      </Animated.ScrollView>

      <View className="mt-3 flex-row items-center justify-center gap-2">
        {items.map((op, i) => (
          <Dot key={op.id} index={i} scrollX={scrollX} snap={snap} />
        ))}
      </View>
    </View>
  );
}
