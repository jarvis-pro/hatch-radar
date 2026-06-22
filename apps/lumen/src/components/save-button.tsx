import { hapticSuccess, hapticTap } from '@/lib/haptics';
import { SPRING_BOUNCY } from '@/lib/motion';
import { useStore } from '@/lib/store';
import { usePalette } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Bookmark } from 'lucide-react-native';
import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

/** 收藏切换按钮：点按时图标回弹 + 触感，已收藏填充品牌色。 */
export function SaveButton({ id, size = 19, className }: { id: string; size?: number; className?: string }) {
  const { isSaved, toggleSave } = useStore();
  const palette = usePalette();
  const saved = isSaved(id);
  const s = useSharedValue(1);

  const onPress = () => {
    s.value = withSequence(withTiming(0.65, { duration: 90 }), withSpring(1, SPRING_BOUNCY));
    if (!saved) hapticSuccess();
    else hapticTap();
    toggleSave(id);
  };

  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));

  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      className={cn(
        'h-9 w-9 items-center justify-center rounded-full border',
        saved ? 'border-primary/40 bg-primary/15' : 'border-white/10 bg-white/5',
        className,
      )}
    >
      <Animated.View style={style}>
        <Bookmark
          size={size}
          color={saved ? palette.primary : palette.mutedForeground}
          fill={saved ? palette.primary : 'transparent'}
          strokeWidth={2.2}
        />
      </Animated.View>
    </Pressable>
  );
}
