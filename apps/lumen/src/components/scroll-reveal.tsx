import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

/**
 * 滚动联动项：卡片随其在视口中的位置缩放 / 淡入淡出 —— 从底部进入时由小放大、
 * 从顶部离开时缩小淡出（animatereactnative 的 scroll-driven list 模式）。
 * 必须作为滚动内容容器的直接子节点，onLayout 的 y 才是相对内容顶的绝对位置。
 */
export function ScrollScaleItem({
  scrollY,
  viewportH,
  children,
  className,
  style,
}: {
  scrollY: SharedValue<number>;
  viewportH: number;
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const y = useSharedValue(0);
  const h = useSharedValue(120);

  const animatedStyle = useAnimatedStyle(() => {
    const top = y.value - scrollY.value; // 距视口顶部的距离
    const scale = interpolate(top, [-h.value, 0, viewportH - 150, viewportH], [0.92, 1, 1, 0.92], Extrapolation.CLAMP);
    const opacity = interpolate(
      top,
      [-h.value, -h.value * 0.3, viewportH - 90, viewportH],
      [0, 1, 1, 0.45],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ scale }] };
  });

  return (
    <Animated.View
      onLayout={(e) => {
        y.value = e.nativeEvent.layout.y;
        h.value = e.nativeEvent.layout.height;
      }}
      className={className}
      style={[animatedStyle, style]}
    >
      {children}
    </Animated.View>
  );
}
