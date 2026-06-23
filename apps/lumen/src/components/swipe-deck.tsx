import { Appear } from '@/components/appear';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/ui/text';
import { OPPORTUNITIES } from '@/data/opportunities';
import type { Opportunity } from '@/data/types';
import { INTENSITY_META, momentumLabel } from '@/lib/format';
import { hapticSelect, hapticSuccess, hapticTap } from '@/lib/haptics';
import { SPRING, SPRING_SOFT } from '@/lib/motion';
import { useStore } from '@/lib/store';
import { INTENSITY_GLOW, usePalette } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useRouter } from 'expo-router';
import { Bookmark, Maximize2, RotateCcw, TrendingDown, TrendingUp, X, type LucideIcon } from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

interface SwipeCardHandle {
  swipeLeft: () => void;
  swipeRight: () => void;
}

const DECK_ORDER = () => [...OPPORTUNITIES].sort((a, b) => b.score - a.score);

/** 编辑式卡面：卡内强度色场 + 巨型幽灵分数 + 超大标题；三向意图标签随拖拽浮现。 */
function SwipeCardFace({ op, tx, ty }: { op: Opportunity; tx: SharedValue<number>; ty: SharedValue<number> }) {
  const palette = usePalette();
  const hue = INTENSITY_GLOW[op.intensity];
  const pp = op.painPoints[0];
  const up = op.momentum >= 0;
  const saveStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [20, 120], [0, 1], Extrapolation.CLAMP) }));
  const skipStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [-120, -20], [1, 0], Extrapolation.CLAMP) }));
  const openStyle = useAnimatedStyle(() => ({ opacity: interpolate(ty.value, [-120, -30], [1, 0], Extrapolation.CLAMP) }));

  return (
    <View
      className="flex-1 overflow-hidden rounded-[34px]"
      style={{ backgroundColor: palette.card, borderWidth: StyleSheet.hairlineWidth, borderColor: `${hue}40` }}
    >
      {/* 卡内强度色场 */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id={`deckcard-${op.id}`} cx="50%" cy="0%" r="95%">
              <Stop offset="0%" stopColor={hue} stopOpacity={0.34} />
              <Stop offset="55%" stopColor={hue} stopOpacity={0.08} />
              <Stop offset="100%" stopColor={hue} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#deckcard-${op.id})`} />
        </Svg>
      </View>

      {/* 巨型幽灵分数 */}
      <View pointerEvents="none" style={{ position: 'absolute', right: -16, bottom: -14 }}>
        <Text style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 200, lineHeight: 260, color: hue, opacity: 0.1 }}>
          {op.score}
        </Text>
      </View>

      {/* 意图标签 */}
      <Animated.View
        style={[saveStyle, { transform: [{ rotate: '-10deg' }] }]}
        className="absolute left-6 top-6 z-10 rounded-xl border-2 border-intensity-low px-3 py-1"
      >
        <Text className="text-lg font-sans-bd text-intensity-low">收藏</Text>
      </Animated.View>
      <Animated.View
        style={[skipStyle, { transform: [{ rotate: '10deg' }] }]}
        className="absolute right-6 top-6 z-10 rounded-xl border-2 border-intensity-high px-3 py-1"
      >
        <Text className="text-lg font-sans-bd text-intensity-high">跳过</Text>
      </Animated.View>
      <Animated.View style={openStyle} className="absolute top-6 z-10 self-center rounded-xl border-2 border-primary px-3 py-1">
        <Text className="text-lg font-sans-bd text-primary">展开 ↑</Text>
      </Animated.View>

      {/* 内容 */}
      <View className="flex-1 p-7">
        <View className="flex-row items-center gap-2.5">
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: hue }} />
          <Text style={{ color: hue }} className="text-[12px] font-sans-sb">
            {INTENSITY_META[op.intensity].label}
          </Text>
          <Text className="text-[12px] font-sans-md uppercase tracking-wider text-muted-foreground">· {op.category}</Text>
        </View>

        <Text className="mt-6 text-[30px] font-sans-bd leading-[1.3] text-foreground">{op.title}</Text>
        <Text className="mt-4 text-[15px] leading-6 text-muted-foreground" numberOfLines={3}>
          {op.pitch}
        </Text>

        <View className="mt-6">
          <Text className="text-[11px] font-sans-sb uppercase tracking-[1.5px]" style={{ color: hue }}>
            核心痛点
          </Text>
          <Text className="mt-2 text-[15px] leading-6 text-foreground" numberOfLines={2}>
            “{pp.text}”
          </Text>
        </View>

        <View className="flex-1" />

        <View className="flex-row items-end justify-between">
          <View className="flex-row items-baseline gap-2">
            <Text style={{ color: hue }} className="font-mono-sb text-[48px] leading-[1.3]">
              {op.score}
            </Text>
            <Text className="mb-1.5 text-xs text-muted-foreground">机会分</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            {up ? (
              <TrendingUp size={15} color={palette.intensityLow} strokeWidth={2.4} />
            ) : (
              <TrendingDown size={15} color={palette.mutedForeground} strokeWidth={2.4} />
            )}
            <Text className={`font-mono-sb text-sm ${up ? 'text-intensity-low' : 'text-muted-foreground'}`}>
              {momentumLabel(op.momentum)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** 顶层可拖拽卡：拥有自己的手势与飞出动画，飞出完成回调 onSwipe；上滑回调 onOpen。 */
const SwipeCard = forwardRef<SwipeCardHandle, { op: Opportunity; onSwipe: (a: 'save' | 'skip') => void; onOpen: () => void }>(
  function SwipeCard({ op, onSwipe, onOpen }, ref) {
    const { width } = useWindowDimensions();
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const mount = useSharedValue(0);

    useEffect(() => {
      mount.value = withSpring(1, SPRING);
    }, [mount]);

    const flyOff = (dir: number) => {
      'worklet';
      tx.value = withTiming(dir * width * 1.5, { duration: 320 }, (finished) => {
        if (finished) runOnJS(onSwipe)(dir > 0 ? 'save' : 'skip');
      });
      ty.value = withTiming(ty.value + 80, { duration: 320 });
    };

    useImperativeHandle(ref, () => ({
      swipeLeft: () => flyOff(-1),
      swipeRight: () => flyOff(1),
    }));

    const pan = Gesture.Pan()
      .onUpdate((e) => {
        tx.value = e.translationX;
        ty.value = e.translationY;
      })
      .onEnd((e) => {
        const T = 110;
        if (e.translationX > T) flyOff(1);
        else if (e.translationX < -T) flyOff(-1);
        else if (e.translationY < -T && Math.abs(e.translationX) < 80) {
          tx.value = withSpring(0, SPRING_SOFT);
          ty.value = withSpring(0, SPRING_SOFT);
          runOnJS(onOpen)();
        } else {
          tx.value = withSpring(0, SPRING_SOFT);
          ty.value = withSpring(0, SPRING_SOFT);
        }
      });

    const cardStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { rotate: `${interpolate(tx.value, [-width, width], [-12, 12], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(mount.value, [0, 1], [0.95, 1]) },
      ],
    }));
    return (
      <GestureDetector gesture={pan}>
        <Animated.View style={[StyleSheet.absoluteFill, cardStyle]}>
          <SwipeCardFace op={op} tx={tx} ty={ty} />
        </Animated.View>
      </GestureDetector>
    );
  },
);

/** 叠层预览卡：缩小下移、降透明，制造卡组纵深。 */
function PreviewCard({ op, depth }: { op: Opportunity; depth: number }) {
  const palette = usePalette();
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { transform: [{ scale: 1 - depth * 0.05 }, { translateY: depth * 16 }], opacity: 1 - depth * 0.4, zIndex: -depth },
      ]}
    >
      <View
        className="flex-1 overflow-hidden rounded-[34px] p-7"
        style={{ backgroundColor: palette.card, borderWidth: StyleSheet.hairlineWidth, borderColor: `${INTENSITY_GLOW[op.intensity]}33` }}
      >
        <View className="flex-row items-center gap-2.5">
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: INTENSITY_GLOW[op.intensity] }} />
          <Text style={{ color: INTENSITY_GLOW[op.intensity] }} className="text-[12px] font-sans-sb">
            {INTENSITY_META[op.intensity].label}
          </Text>
        </View>
        <Text className="mt-6 text-[30px] font-sans-bd leading-[1.3] text-foreground" numberOfLines={2}>
          {op.title}
        </Text>
      </View>
    </Animated.View>
  );
}

const ACTIONS: Record<string, { Icon: LucideIcon; tone: string; ring: string; big: boolean; size: number }> = {
  skip: { Icon: X, tone: 'bg-intensity-high/14', ring: 'border-intensity-high/35', big: true, size: 26 },
  detail: { Icon: Maximize2, tone: 'bg-primary/14', ring: 'border-primary/35', big: false, size: 19 },
  save: { Icon: Bookmark, tone: 'bg-intensity-low/14', ring: 'border-intensity-low/35', big: true, size: 23 },
};

function ActionButton({ kind, color, onPress }: { kind: keyof typeof ACTIONS; color: string; onPress: () => void }) {
  const palette = usePalette();
  const c = ACTIONS[kind];
  return (
    <PressableScale
      scaleTo={0.86}
      onPress={() => {
        hapticTap();
        onPress();
      }}
    >
      <View
        className={cn(
          'items-center justify-center overflow-hidden rounded-full border',
          c.big ? 'h-16 w-16' : 'h-12 w-12',
          c.ring,
        )}
        style={{ backgroundColor: palette.card }}
      >
        <View className={cn('absolute inset-0', c.tone)} />
        <c.Icon size={c.size} color={color} strokeWidth={2.4} />
      </View>
    </PressableScale>
  );
}

function DeckProgress({ value }: { value: number }) {
  return (
    <View className="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10">
      <View className="h-full rounded-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} />
    </View>
  );
}

function EmptyDeck({ onReshuffle, savedCount }: { onReshuffle: () => void; savedCount: number }) {
  const palette = usePalette();
  return (
    <Appear from="none" duration={500} className="flex-1 items-center justify-center px-10">
      <Text className="text-[64px] font-sans-bd leading-none text-foreground" style={{ opacity: 0.12 }}>
        ✓
      </Text>
      <Text className="mt-4 text-xl font-sans-bd text-foreground">本轮研判完成</Text>
      <Text className="mt-3 text-center text-[14px] leading-6 text-muted-foreground">
        你已看完全部机会，收藏了 <Text className="font-mono-sb text-primary">{savedCount}</Text> 个。{'\n'}重新洗牌再来一轮。
      </Text>
      <PressableScale scaleTo={0.94} onPress={onReshuffle} className="mt-7">
        <View className="flex-row items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-5 py-3">
          <RotateCcw size={17} color={palette.primary} strokeWidth={2.4} />
          <Text className="text-[14px] font-sans-sb text-primary">重新洗牌</Text>
        </View>
      </PressableScale>
    </Appear>
  );
}

/** 卡组背景强度光晕：顶卡切换时淡入新色（与首页轮播同款色语言）。 */
function DeckGlow({ color }: { color: string }) {
  const o = useSharedValue(0);
  useEffect(() => {
    o.value = withTiming(1, { duration: 480 });
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  const id = `deck-glow-${color.replace('#', '')}`;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="40%" r="60%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <Stop offset="60%" stopColor={color} stopOpacity={0.12} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** 手势滑卡卡组：右滑收藏 / 左滑跳过 / 上滑展开详情，底部按钮联动同一套动画。 */
export function SwipeDeck() {
  const router = useRouter();
  const palette = usePalette();
  const { toggleSave, dismiss, restoreDeck, savedIds } = useStore();
  const [cards, setCards] = useState<Opportunity[]>(DECK_ORDER);
  const [cursor, setCursor] = useState(0);
  const cardRef = useRef<SwipeCardHandle>(null);

  const total = cards.length;

  const handleSwipe = useCallback(
    (action: 'save' | 'skip', op: Opportunity) => {
      if (action === 'save') {
        if (!savedIds.includes(op.id)) toggleSave(op.id);
        hapticSuccess();
      } else {
        dismiss(op.id);
      }
      setCursor((c) => c + 1);
    },
    [toggleSave, dismiss, savedIds],
  );

  const openDetail = useCallback(
    (op: Opportunity) => {
      hapticSelect();
      router.push(`/opportunity/${op.id}`);
    },
    [router],
  );

  const reshuffle = useCallback(() => {
    restoreDeck();
    setCards(DECK_ORDER());
    setCursor(0);
  }, [restoreDeck]);

  if (cursor >= total) return <EmptyDeck onReshuffle={reshuffle} savedCount={savedIds.length} />;

  const front = cards[cursor];
  const next = cards[cursor + 1];
  const third = cards[cursor + 2];

  return (
    <View className="flex-1">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <DeckGlow key={front.id} color={INTENSITY_GLOW[front.intensity]} />
      </View>

      <View className="flex-row items-center justify-between px-5 pb-1">
        <Text className="text-[13px] text-muted-foreground">
          已研判 <Text className="font-mono-sb text-foreground">{cursor}</Text> / {total}
        </Text>
        <DeckProgress value={cursor / total} />
      </View>

      <View className="flex-1 px-5 pb-1 pt-3">
        <View style={{ flex: 1, position: 'relative' }}>
          {third ? <PreviewCard op={third} depth={2} /> : null}
          {next ? <PreviewCard op={next} depth={1} /> : null}
          <SwipeCard
            key={front.id}
            ref={cardRef}
            op={front}
            onSwipe={(a) => handleSwipe(a, front)}
            onOpen={() => openDetail(front)}
          />
        </View>
      </View>

      <View className="flex-row items-center justify-center gap-6 pt-3">
        <ActionButton kind="skip" color={palette.intensityHigh} onPress={() => cardRef.current?.swipeLeft()} />
        <ActionButton kind="detail" color={palette.primary} onPress={() => openDetail(front)} />
        <ActionButton kind="save" color={palette.intensityLow} onPress={() => cardRef.current?.swipeRight()} />
      </View>
    </View>
  );
}
