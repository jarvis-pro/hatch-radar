import { PulseDot } from '@/components/brand';
import { Text } from '@/components/ui/text';
import type { ScanSource } from '@/data/types';
import { usePalette } from '@/lib/theme';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const GAP = 10;

function SourceRow({ items, onLayout }: { items: ScanSource[]; onLayout?: (w: number) => void }) {
  const palette = usePalette();
  return (
    <View
      style={{ flexDirection: 'row', gap: GAP, paddingRight: GAP }}
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.width) : undefined}
    >
      {items.map((s, i) => (
        <View
          key={`${s.label}-${i}`}
          className="flex-row items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"
        >
          <PulseDot color={palette.signal} size={6} />
          <Text className="text-[12px] font-sans-md text-foreground">{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * 跑马灯：实时源横向无缝循环滚动（animatereactnative 的 Marquee 模式）。
 * 渲染两份内容首尾相接，匀速平移一份宽度后由 withRepeat 无缝接续，强化「实时扫描」的流动感。
 */
export function Marquee({ items, speed = 32 }: { items: ScanSource[]; speed?: number }) {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);

  useEffect(() => {
    if (!w) return;
    x.value = 0;
    x.value = withRepeat(withTiming(-w, { duration: (w / speed) * 1000, easing: Easing.linear }), -1, false);
  }, [w, speed, x]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={{ overflow: 'hidden' }} pointerEvents="none">
      <Animated.View style={[{ flexDirection: 'row' }, style]}>
        <SourceRow items={items} onLayout={setW} />
        <SourceRow items={items} />
      </Animated.View>
    </View>
  );
}
