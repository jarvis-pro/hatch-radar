import { EASE_SINE } from '@/lib/motion';
import { usePalette } from '@/lib/theme';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/** 单个光斑的几何与节律（相对屏幕尺寸，缓慢往复漂移）。 */
interface Geo {
  size: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  dur: number;
  delay: number;
}

function blobGeometry(w: number, h: number): Geo[] {
  return [
    { size: w * 1.15, x0: -w * 0.3, x1: -w * 0.12, y0: -h * 0.08, y1: h * 0.02, dur: 11000, delay: 0 },
    { size: w * 1.0, x0: w * 0.42, x1: w * 0.58, y0: h * 0.08, y1: h * 0.2, dur: 14000, delay: 900 },
    { size: w * 1.05, x0: w * 0.0, x1: w * 0.16, y0: h * 0.5, y1: h * 0.62, dur: 17000, delay: 1800 },
  ];
}

function Blob({
  geo,
  color,
  opacity,
  id,
}: {
  geo: Geo;
  color: string;
  opacity: number;
  id: string;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      geo.delay,
      withRepeat(withTiming(1, { duration: geo.dur, easing: EASE_SINE }), -1, true),
    );
  }, [t, geo.delay, geo.dur]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 1], [geo.x0, geo.x1]) },
      { translateY: interpolate(t.value, [0, 1], [geo.y0, geo.y1]) },
      { scale: interpolate(t.value, [0, 1], [0.9, 1.12]) },
    ],
    opacity: interpolate(t.value, [0, 1], [0.72, 1]),
  }));

  return (
    <Animated.View style={[{ position: 'absolute', width: geo.size, height: geo.size }, style]}>
      <Svg width={geo.size} height={geo.size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
            <Stop offset="55%" stopColor={color} stopOpacity={opacity * 0.45} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={geo.size / 2} cy={geo.size / 2} r={geo.size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * 极光环境背景：近黑墨蓝底 + 三团缓慢漂移/呼吸的径向渐变光斑。
 * 玻璃面叠在它之上才有「透过玻璃看见远处光」的层次。pointerEvents=none，不挡触摸。
 */
export function AuroraBackground() {
  const { width, height } = useWindowDimensions();
  const palette = usePalette();
  const geo = blobGeometry(width, height);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.background, overflow: 'hidden' }]}
    >
      {palette.aurora.map((b, i) => (
        <Blob key={i} id={`aurora-${i}`} geo={geo[i]} color={b.color} opacity={b.opacity} />
      ))}
    </View>
  );
}
