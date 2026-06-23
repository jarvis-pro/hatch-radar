import { PulseDot } from '@/components/brand';
import { IntroScene } from '@/components/intro-scene';
import { OpportunityScene } from '@/components/opportunity-scene';
import { ReelBackground } from '@/components/reel-background';
import { Text } from '@/components/ui/text';
import { OPPORTUNITIES } from '@/data/opportunities';
import type { Opportunity } from '@/data/types';
import { hapticSelect } from '@/lib/haptics';
import { INTENSITY_GLOW, usePalette } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { type EdgeInsets, useSafeAreaInsets } from 'react-native-safe-area-context';

/** 滚动过 intro 后淡入的迷你品牌头。 */
function MiniHeader({ scrollY, height, insets }: { scrollY: SharedValue<number>; height: number; insets: EdgeInsets }) {
  const palette = usePalette();
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [height * 0.55, height * 0.95], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [height * 0.55, height * 0.95], [-10, 0], Extrapolation.CLAMP) }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, alignItems: 'center' }, style]}
    >
      <View className="flex-row items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5">
        <PulseDot color={palette.signal} size={6} />
        <Text className="text-[13px] font-sans-bd tracking-tight text-foreground">Lumen</Text>
      </View>
    </Animated.View>
  );
}

/** 右侧进度轨的一颗：当前场景的点拉长提亮。 */
function RailDot({ index, scrollY, height }: { index: number; scrollY: SharedValue<number>; height: number }) {
  const palette = usePalette();
  const style = useAnimatedStyle(() => {
    const d = Math.abs(scrollY.value / height - index);
    return {
      height: interpolate(d, [0, 1], [22, 7], Extrapolation.CLAMP),
      opacity: interpolate(d, [0, 1], [1, 0.3], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: palette.foreground }, style]} />;
}

export default function RadarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const radarSize = Math.min(width * 0.58, 248);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const featured = useMemo(() => [...OPPORTUNITIES].sort((a, b) => b.score - a.score).slice(0, 7), []);
  const colors = useMemo(() => ['#6C63FF', ...featured.map((o) => INTENSITY_GLOW[o.intensity])], [featured]);

  const open = (op: Opportunity) => {
    hapticSelect();
    router.push(`/opportunity/${op.id}`);
  };

  return (
    <View style={{ flex: 1 }}>
      <ReelBackground colors={colors} scrollY={scrollY} height={height} />

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={height}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
      >
        <IntroScene
          scrollY={scrollY}
          height={height}
          width={width}
          radarSize={radarSize}
          opportunities={OPPORTUNITIES}
          newCount={OPPORTUNITIES.length}
          insets={insets}
          onSelectBlip={open}
        />
        {featured.map((op, i) => (
          <OpportunityScene
            key={op.id}
            op={op}
            sceneIndex={i + 1}
            number={i + 1}
            total={featured.length}
            scrollY={scrollY}
            height={height}
            width={width}
            insets={insets}
            onPress={() => open(op)}
          />
        ))}
      </Animated.ScrollView>

      <MiniHeader scrollY={scrollY} height={height} insets={insets} />

      <View pointerEvents="none" style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center', gap: 8 }}>
        {Array.from({ length: featured.length + 1 }).map((_, i) => (
          <RailDot key={i} index={i} scrollY={scrollY} height={height} />
        ))}
      </View>
    </View>
  );
}
