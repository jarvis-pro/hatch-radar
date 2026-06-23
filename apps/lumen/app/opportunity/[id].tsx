import { useCountUp } from '@/components/animated-number';
import { AuroraBackground } from '@/components/aurora-background';
import { HueWash } from '@/components/editorial';
import { Text } from '@/components/ui/text';
import { getOpportunity } from '@/data/opportunities';
import { agoLabel, compact, INTENSITY_META, momentumLabel, SOURCE_LABEL } from '@/lib/format';
import { hapticSuccess, hapticTap } from '@/lib/haptics';
import { useStore } from '@/lib/store';
import { INTENSITY_GLOW, usePalette } from '@/lib/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowUp, Bookmark, ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View className="flex-1">
      <Text className="font-mono-sb text-[20px] leading-[1.3] text-foreground" style={color ? { color } : undefined}>
        {value}
      </Text>
      <Text className="mt-1 text-[11px] text-muted-foreground">{label}</Text>
    </View>
  );
}

function VRule() {
  const palette = usePalette();
  return <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: palette.hairline, marginHorizontal: 16 }} />;
}

function PainPoint({ text, frequency, delay, hue }: { text: string; frequency: number; delay: number; hue: string }) {
  const v = useCountUp(frequency, { duration: 950, delay });
  return (
    <View className="mb-7">
      <View className="flex-row items-baseline gap-4">
        <Text style={{ color: hue, width: 56 }} className="font-mono-sb text-[24px] leading-[1.3]">
          {Math.round(v)}%
        </Text>
        <Text className="flex-1 text-[15px] leading-6 text-foreground">{text}</Text>
      </View>
      <View className="mt-3 h-[3px] overflow-hidden rounded-full bg-foreground/[0.08]">
        <View className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: hue }} />
      </View>
    </View>
  );
}

export default function OpportunityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const { isSaved, toggleSave } = useStore();

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 360], [0.15, 0.05], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [0, 500], [0, -90], Extrapolation.CLAMP) }],
  }));

  const op = getOpportunity(id);
  if (!op) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}>
        <Text className="text-muted-foreground">未找到该机会</Text>
      </View>
    );
  }

  const hue = INTENSITY_GLOW[op.intensity];
  const saved = isSaved(op.id);
  const up = op.momentum >= 0;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <AuroraBackground />
      <HueWash color={hue} opacity={0.52} />

      {/* 巨型幽灵分数（与场景延续，固定 + 缓速视差） */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', right: -width * 0.06, bottom: insets.bottom + 40 }, ghostStyle]}
      >
        <Text
          style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: width * 0.66, lineHeight: width * 0.66 * 1.3, color: hue }}
        >
          {op.score}
        </Text>
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 60, paddingBottom: insets.bottom + 64, paddingHorizontal: 28 }}
      >
        {/* eyebrow */}
        <View className="flex-row items-center gap-3">
          <View
            className="flex-row items-center gap-2 rounded-full px-3 py-1.5"
            style={{ backgroundColor: `${hue}1F`, borderWidth: StyleSheet.hairlineWidth, borderColor: `${hue}55` }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hue }} />
            <Text style={{ color: hue }} className="text-[12px] font-sans-sb">
              {INTENSITY_META[op.intensity].label}
            </Text>
          </View>
          <Text className="text-[12px] font-sans-md uppercase tracking-wider text-muted-foreground">{op.category}</Text>
        </View>

        {/* huge title */}
        <Text className="mt-5 text-[40px] font-sans-bd leading-[1.3] text-foreground">{op.title}</Text>
        <Text className="mt-5 text-[16px] leading-7 text-muted-foreground">{op.pitch}</Text>
        <Text className="mt-4 font-mono text-[12px] text-muted-foreground">
          {SOURCE_LABEL[op.source]} · {op.channel} · {agoLabel(op.ageMinutes)}
        </Text>

        {/* stats strip */}
        <View className="mt-10 flex-row items-start">
          <Stat value={`${op.score}`} label="机会分" color={hue} />
          <VRule />
          <Stat
            value={momentumLabel(op.momentum)}
            label="近 7 日"
            color={up ? palette.intensityLow : palette.mutedForeground}
          />
          <VRule />
          <Stat value={compact(op.mentions)} label="声量" />
          <VRule />
          <Stat value={`${op.communities}`} label="社区" />
        </View>

        {/* 用户痛点 */}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline }} className="mt-14" />
        <Text className="mb-7 mt-6 text-[12px] font-sans-sb uppercase tracking-[2px]" style={{ color: hue }}>
          用户痛点
        </Text>
        {op.painPoints.map((pp, i) => (
          <PainPoint key={i} text={pp.text} frequency={pp.frequency} delay={250 + i * 130} hue={hue} />
        ))}

        {/* 社区原声 */}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline }} className="mt-14" />
        <Text className="mb-7 mt-6 text-[12px] font-sans-sb uppercase tracking-[2px]" style={{ color: hue }}>
          社区原声
        </Text>
        {op.evidence.map((ev, i) => (
          <View key={i} className="mb-6">
            <Text className="text-[18px] leading-[1.6] text-foreground">“{ev.quote}”</Text>
            <View className="mt-3 flex-row items-center">
              <Text className="flex-1 font-mono text-[12px] text-muted-foreground">
                {ev.author} · {ev.channel}
              </Text>
              <ArrowUp size={12} color={palette.signal} strokeWidth={2.6} />
              <Text className="ml-1 font-mono-sb text-[12px] text-signal">{compact(ev.upvotes)}</Text>
            </View>
            {i < op.evidence.length - 1 ? (
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline, marginTop: 22 }} />
            ) : null}
          </View>
        ))}

        {/* tags */}
        <Text className="mt-12 font-mono text-[12px] text-muted-foreground">{op.tags.map((t) => `#${t}`).join('  ')}</Text>

        {/* CTA */}
        <Pressable
          onPress={() => {
            if (!saved) hapticSuccess();
            else hapticTap();
            toggleSave(op.id);
          }}
          className="mt-12 flex-row items-center justify-center gap-2.5 rounded-2xl py-4"
          style={{ backgroundColor: saved ? `${hue}2E` : `${hue}1A`, borderWidth: StyleSheet.hairlineWidth, borderColor: `${hue}66` }}
        >
          <Bookmark size={18} color={hue} fill={saved ? hue : 'transparent'} strokeWidth={2.3} />
          <Text style={{ color: hue }} className="text-[15px] font-sans-sb">
            {saved ? '已收藏到灵感板' : '收藏这个机会'}
          </Text>
        </Pressable>
      </Animated.ScrollView>

      {/* 顶部悬浮：返回 + 收藏 */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 8 }}
        className="flex-row items-center justify-between px-5"
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full border border-border bg-foreground/[0.08]"
        >
          <ChevronLeft size={22} color={palette.foreground} strokeWidth={2.4} />
        </Pressable>
        <Pressable
          onPress={() => {
            if (!saved) hapticSuccess();
            else hapticTap();
            toggleSave(op.id);
          }}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full border border-border bg-foreground/[0.08]"
        >
          <Bookmark size={18} color={saved ? hue : palette.foreground} fill={saved ? hue : 'transparent'} strokeWidth={2.3} />
        </Pressable>
      </View>
    </View>
  );
}
