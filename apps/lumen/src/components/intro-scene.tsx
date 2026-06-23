import { RadarScope } from '@/components/radar-scope';
import { Text } from '@/components/ui/text';
import type { Opportunity } from '@/data/types';
import { EASE_SINE } from '@/lib/motion';
import { usePalette } from '@/lib/theme';
import { ChevronDown } from 'lucide-react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { EdgeInsets } from 'react-native-safe-area-context';

/**
 * 变形 intro 场景：巨型 LUMEN 字标 + 动态雷达。随着下滚（scrollY → height），
 * 整组上移、缩小、淡出——把开场"让位"给下方的机会 reel（scrolling-intro 叙事）。
 */
export function IntroScene({
  scrollY,
  height,
  width,
  radarSize,
  opportunities,
  newCount,
  insets,
  onSelectBlip,
}: {
  scrollY: SharedValue<number>;
  height: number;
  width: number;
  radarSize: number;
  opportunities: Opportunity[];
  newCount: number;
  insets: EdgeInsets;
  onSelectBlip: (op: Opportunity) => void;
}) {
  const palette = usePalette();
  const bob = useSharedValue(0);
  useEffect(() => {
    bob.value = withRepeat(withTiming(1, { duration: 1100, easing: EASE_SINE }), -1, true);
  }, [bob]);

  const heroStyle = useAnimatedStyle(() => {
    const rel = scrollY.value / height;

    return {
      opacity: interpolate(rel, [0, 0.7], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(rel, [0, 1], [0, -height * 0.34], Extrapolation.CLAMP) },
        { scale: interpolate(rel, [0, 1], [1, 0.66], Extrapolation.CLAMP) },
      ],
    };
  });

  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, height * 0.22], [1, 0], Extrapolation.CLAMP),
  }));
  const bobStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(bob.value, [0, 1], [0, 9]) }],
  }));

  return (
    <View
      style={{
        height,
        width,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: insets.top,
      }}
    >
      <Animated.View style={heroStyle} className="items-center">
        <RadarScope size={radarSize} opportunities={opportunities} onSelectBlip={onSelectBlip} />
        <Text className="mt-9 text-[62px] font-sans-bd leading-none tracking-tight text-foreground">
          Lumen
        </Text>
        <Text className="mt-3 text-[13px] font-sans-sb uppercase tracking-[4px] text-primary">
          AI 产品灵感雷达
        </Text>
      </Animated.View>

      <Animated.View
        style={[hintStyle, { position: 'absolute', bottom: insets.bottom + 104 }]}
        className="items-center"
        pointerEvents="none"
      >
        <Text className="mb-3 text-[12px] text-muted-foreground">
          今日 <Text className="font-mono-sb text-foreground">{newCount}</Text> 个新机会
        </Text>
        <Animated.View style={bobStyle}>
          <ChevronDown size={22} color={palette.mutedForeground} strokeWidth={2.4} />
        </Animated.View>
        <Text className="mt-1 text-[10px] uppercase tracking-[3px] text-muted-foreground">
          向下滑动
        </Text>
      </Animated.View>
    </View>
  );
}
