import type { Intensity } from '@/data/types';
import { type Palette, usePalette } from '@/lib/theme';
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

/** 强度光点：可选向外扩散的脉冲光环（雷达光点用）。 */
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
