import { Text } from '@/components/ui/text';
import { hapticSelect } from '@/lib/haptics';
import { SPRING, SPRING_SOFT } from '@/lib/motion';
import { usePalette } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Bookmark, Radar, Sparkles, User, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ICONS: Record<string, LucideIcon> = {
  index: Radar,
  explore: Sparkles,
  saved: Bookmark,
  profile: User,
};

const PAD = 6;

/** 最小化 Tab 栏 props（只声明本组件读取的字段，由调用处自动推断结构兼容）。 */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
}

function TabIcon({ Icon, focused, color }: { Icon: LucideIcon; focused: boolean; color: string }) {
  const s = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    s.value = withSpring(focused ? 1 : 0, SPRING);
  }, [focused, s]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(s.value, [0, 1], [0, -1]) }, { scale: interpolate(s.value, [0, 1], [1, 1.1]) }],
  }));
  return (
    <Animated.View style={style}>
      <Icon size={22} color={color} strokeWidth={focused ? 2.5 : 2} />
    </Animated.View>
  );
}

/**
 * 浮动极简 Tab 栏：实心暗条 + 发丝边（无玻璃 / 模糊），活动项下有一颗随弹簧滑动的高亮药丸，
 * 焦点图标弹起、文字转品牌色，切换带选择触感。
 */
export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const tabW = width > 0 ? (width - PAD * 2) / count : 0;

  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withSpring(state.index * tabW, SPRING_SOFT);
  }, [state.index, tabW, x]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 10, alignItems: 'center' }}
    >
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        className="flex-row rounded-full p-1.5"
        style={{
          width: '88%',
          maxWidth: 460,
          backgroundColor: palette.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.hairlineSoft,
        }}
      >
        {tabW > 0 ? (
          <Animated.View
            pointerEvents="none"
            className="rounded-full border border-primary/30 bg-primary/15"
            style={[{ position: 'absolute', top: PAD, bottom: PAD, left: PAD, width: tabW }, pillStyle]}
          />
        ) : null}

        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const { options } = descriptors[route.key];
          const label = (options.title ?? route.name) as string;
          const Icon = ICONS[route.name] ?? Radar;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              hapticSelect();
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable key={route.key} onPress={onPress} className="flex-1 items-center justify-center gap-1 py-2.5">
              <TabIcon Icon={Icon} focused={focused} color={focused ? palette.primary : palette.mutedForeground} />
              <Text className={cn('text-[10px] font-sans-md', focused ? 'text-primary' : 'text-muted-foreground')}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
