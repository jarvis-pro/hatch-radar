import { Text } from '@/components/ui/text';
import type { Intensity } from '@/data/types';
import { INTENSITY_META } from '@/lib/format';
import { type Palette, usePalette } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

function colorFor(palette: Palette, intensity: Intensity): string {
  return intensity === 'high'
    ? palette.intensityHigh
    : intensity === 'medium'
      ? palette.intensityMedium
      : palette.intensityLow;
}

/** 强度光点：可选向外扩散的脉冲光环（雷达光点、列表前导点用）。 */
export function IntensityDot({
  intensity,
  size = 8,
  pulse = true,
}: {
  intensity: Intensity;
  size?: number;
  pulse?: boolean;
}) {
  const palette = usePalette();
  const color = colorFor(palette, intensity);
  const t = useSharedValue(0);

  useEffect(() => {
    if (!pulse) return;
    t.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.ease) }), -1, false);
  }, [pulse, t]);

  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(t.value, [0, 1], [1, 2.8]) }],
    opacity: interpolate(t.value, [0, 1], [0.5, 0]),
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {pulse ? (
        <Animated.View
          style={[
            { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color },
            ring,
          ]}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/** 强度药丸徽标：柔色底 + 静态点 + 中文标签。 */
export function IntensityPill({ intensity, className }: { intensity: Intensity; className?: string }) {
  const m = INTENSITY_META[intensity];
  return (
    <View
      className={cn('flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1', m.soft, className)}
    >
      <IntensityDot intensity={intensity} size={6} pulse={false} />
      <Text className={cn('text-xs font-sans-sb', m.text)}>{m.label}</Text>
    </View>
  );
}
