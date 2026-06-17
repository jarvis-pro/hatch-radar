import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * 信号脉冲点（系统脉搏 / 在线指示）：信号青呼吸动画 + 减动开启时静止。
 * online=false → 灰静止点。对齐 Web 的 signal-pulse。
 */
export function SignalDot({ online = true, size = 10 }: { online?: boolean; size?: number }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];
  const color = online ? theme.signal : theme.mutedForeground;
  const scale = useSharedValue(1);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!online || reduceMotion) {
      cancelAnimation(scale);
      scale.value = 1;
      return;
    }
    scale.value = withRepeat(
      withTiming(0.68, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(scale);
  }, [online, reduceMotion, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 0.4 + ((scale.value - 0.68) / 0.32) * 0.6,
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
          opacity: 0.32,
        }}
      />
      <Animated.View
        style={[
          { width: size * 0.52, height: size * 0.52, borderRadius: size, backgroundColor: color },
          animStyle,
        ]}
      />
    </View>
  );
}
