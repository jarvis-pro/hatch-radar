import { DUR, EASE_OUT } from '@/lib/motion';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

/**
 * 入场动画：挂载时淡入 + 轻微位移。用 useSharedValue + useAnimatedStyle 实现
 * （而非 reanimated 的 entering 布局动画）——后者在 web 端会卡在初始 opacity:0，
 * 而本实现与极光/计数同款机制，web 与原生都可靠。
 */
export function Appear({
  children,
  delay = 0,
  from = 'down',
  distance = 14,
  duration = DUR.base,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  from?: 'down' | 'up' | 'none';
  distance?: number;
  duration?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration, easing: EASE_OUT }));
  }, [p, delay, duration]);

  const offset = from === 'down' ? distance : from === 'up' ? -distance : 0;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: interpolate(p.value, [0, 1], [offset, 0]) }],
  }));

  return (
    <Animated.View className={className} style={[animatedStyle, style]}>
      {children}
    </Animated.View>
  );
}
