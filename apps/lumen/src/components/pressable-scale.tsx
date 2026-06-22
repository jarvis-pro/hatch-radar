import { SPRING } from '@/lib/motion';
import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

interface PressableScaleProps extends Omit<PressableProps, 'children' | 'style'> {
  children?: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** 按下时缩到多少（默认 0.96）。 */
  scaleTo?: number;
}

/**
 * 通用按压缩放：触摸即弹簧缩小、松手回弹。全 App 的可点元素都包它，
 * 统一「按下去有回应」的高级手感。className 落在内层动画 View 上。
 */
export function PressableScale({
  children,
  className,
  style,
  scaleTo = 0.96,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const s = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));

  return (
    <Pressable
      onPressIn={(e) => {
        s.value = withSpring(scaleTo, SPRING);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, SPRING);
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View className={className} style={[animatedStyle, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
