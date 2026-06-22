import { GlassCard } from '@/components/glass';
import { Text } from '@/components/ui/text';
import { usePalette } from '@/lib/theme';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';

/** Lumen 品牌徽标：静态雷达母题（同心环 + 扫掠线 + 核），品牌靛紫 / 信号青。 */
export function LumenMark({ size = 28 }: { size?: number }) {
  const p = usePalette();
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      <Circle cx={14} cy={14} r={12.5} fill="none" stroke={p.primary} strokeWidth={1.4} strokeOpacity={0.3} />
      <Circle cx={14} cy={14} r={7.5} fill="none" stroke={p.signal} strokeWidth={1.4} strokeOpacity={0.55} />
      <Line x1={14} y1={14} x2={23} y2={7} stroke={p.signal} strokeWidth={1.6} />
      <Circle cx={14} cy={14} r={2.6} fill={p.primary} />
    </Svg>
  );
}

/** 通用脉冲光点：实心点 + 向外扩散淡出的光环。 */
export function PulseDot({ color, size = 7 }: { color: string; size?: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }), -1, false);
  }, [t]);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(t.value, [0, 1], [1, 3]) }],
    opacity: interpolate(t.value, [0, 1], [0.5, 0]),
  }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, ring]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/** 实时状态徽标：玻璃胶囊 + 脉冲信号点 + 文案。 */
export function LiveBadge({ label = '实时扫描' }: { label?: string }) {
  const p = usePalette();
  return (
    <GlassCard sheen={false} className="flex-row items-center gap-2 rounded-full px-3 py-1.5">
      <PulseDot color={p.signal} size={7} />
      <Text className="text-[11px] font-sans-sb tracking-wide text-foreground">{label}</Text>
    </GlassCard>
  );
}
