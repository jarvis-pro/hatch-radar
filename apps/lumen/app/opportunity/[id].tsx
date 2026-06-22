import { useCountUp } from '@/components/animated-number';
import { Appear } from '@/components/appear';
import { GlassCard } from '@/components/glass';
import { IntensityPill } from '@/components/intensity';
import { PressableScale } from '@/components/pressable-scale';
import { SaveButton } from '@/components/save-button';
import { Text } from '@/components/ui/text';
import { getOpportunity } from '@/data/opportunities';
import type { Intensity } from '@/data/types';
import { agoLabel, compact, momentumLabel, SOURCE_LABEL } from '@/lib/format';
import { hapticSuccess, hapticTap } from '@/lib/haptics';
import { useStore } from '@/lib/store';
import { type Palette, usePalette } from '@/lib/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowUp, ChevronLeft, Radio, TrendingDown, TrendingUp, Users } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

function intensityColor(palette: Palette, intensity: Intensity): string {
  return intensity === 'high' ? palette.intensityHigh : intensity === 'medium' ? palette.intensityMedium : palette.intensityLow;
}

/** 顶部强度色径向光晕（视差英雄头背景）。 */
function HeroGlow({ color, width }: { color: string; width: number }) {
  const h = 320;
  return (
    <Svg width={width} height={h} style={{ position: 'absolute', top: -40 }} pointerEvents="none">
      <Defs>
        <RadialGradient id="hero-glow" cx="50%" cy="28%" r="62%">
          <Stop offset="0%" stopColor={color} stopOpacity={0.34} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={width / 2} cy={h * 0.28} r={width * 0.7} fill="url(#hero-glow)" />
    </Svg>
  );
}

/** 机会分环：RAF 驱动的环形进度 + 同步滚动的中心读数。 */
function ScoreRing({ score, color, size = 100 }: { score: number; color: string; size?: number }) {
  const palette = usePalette();
  const stroke = 7;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const v = useCountUp(score, { duration: 1300, delay: 200 });
  const offset = C * (1 - v / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={palette.mutedForeground} strokeOpacity={0.16} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={C}
          strokeDashoffset={offset}
        />
      </Svg>
      <Text className="font-mono-sb text-[27px] text-foreground">{Math.round(v)}</Text>
      <Text className="text-[10px] text-muted-foreground">机会分</Text>
    </View>
  );
}

/** 痛点频度条：挂载时填充至目标百分比。 */
function PainPointBar({ text, frequency, delay }: { text: string; frequency: number; delay: number }) {
  const v = useCountUp(frequency, { duration: 950, delay });
  return (
    <View className="mb-4">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-[14px] leading-5 text-foreground">{text}</Text>
        <Text className="font-mono-sb text-[13px] text-intensity-high">{Math.round(v)}%</Text>
      </View>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-white/8">
        <View className="h-full rounded-full bg-intensity-high" style={{ width: `${v}%` }} />
      </View>
    </View>
  );
}

function StatRow({ icon, label, value, valueClass }: { icon: ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <View className="flex-row items-center gap-2.5 py-1.5">
      {icon}
      <Text className="flex-1 text-[13px] text-muted-foreground">{label}</Text>
      <Text className={valueClass ?? 'font-mono-sb text-[14px] text-foreground'}>{value}</Text>
    </View>
  );
}

export default function OpportunityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { isSaved, toggleSave } = useStore();

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const heroStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scrollY.value, [-120, 0, 200], [60, 0, 80], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [-120, 0], [1.12, 1], Extrapolation.CLAMP) },
    ],
    opacity: interpolate(scrollY.value, [0, 190], [1, 0.25], Extrapolation.CLAMP),
  }));

  const op = getOpportunity(id);
  if (!op) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}>
        <Text className="text-muted-foreground">未找到该机会</Text>
      </View>
    );
  }

  const color = intensityColor(palette, op.intensity);
  const saved = isSaved(op.id);
  const up = op.momentum >= 0;

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
      >
        {/* 视差英雄头 */}
        <Animated.View style={heroStyle}>
          <HeroGlow color={color} width={420} />
          <View style={{ paddingTop: insets.top + 64 }} className="px-6 pb-2">
            <View className="flex-row items-center gap-2">
              <IntensityPill intensity={op.intensity} />
              <Text className="text-[12px] font-sans-md text-muted-foreground">{op.category}</Text>
            </View>
            <Text className="mt-4 text-[30px] font-sans-bd leading-[1.15] text-foreground">{op.title}</Text>
            <Text className="mt-3 text-[15px] leading-6 text-muted-foreground">{op.pitch}</Text>
            <Text className="mt-3 font-mono text-[12px] text-muted-foreground">
              {SOURCE_LABEL[op.source]} · {op.channel} · {agoLabel(op.ageMinutes)}
            </Text>
          </View>
        </Animated.View>

        {/* 机会分 + 指标 */}
        <Appear delay={120} className="px-5 pt-4">
          <GlassCard className="flex-row items-center gap-5 rounded-[26px] p-5">
            <ScoreRing score={op.score} color={color} />
            <View className="flex-1">
              <StatRow
                icon={up ? <TrendingUp size={16} color={palette.intensityLow} strokeWidth={2.4} /> : <TrendingDown size={16} color={palette.mutedForeground} strokeWidth={2.4} />}
                label="近 7 日动量"
                value={momentumLabel(op.momentum)}
                valueClass={`font-mono-sb text-[14px] ${up ? 'text-intensity-low' : 'text-muted-foreground'}`}
              />
              <View className="h-px bg-white/8" />
              <StatRow icon={<Radio size={16} color={palette.signal} strokeWidth={2.2} />} label="信号声量" value={compact(op.mentions)} />
              <View className="h-px bg-white/8" />
              <StatRow icon={<Users size={16} color={palette.primary} strokeWidth={2.2} />} label="覆盖社区" value={`${op.communities} 个`} />
            </View>
          </GlassCard>
        </Appear>

        {/* 痛点 */}
        <Appear delay={200} className="px-5 pt-4">
          <Text className="mb-3 px-1 text-xs font-sans-sb uppercase tracking-wider text-primary">用户痛点</Text>
          <GlassCard className="rounded-[26px] p-5">
            {op.painPoints.map((pp, i) => (
              <PainPointBar key={i} text={pp.text} frequency={pp.frequency} delay={300 + i * 140} />
            ))}
          </GlassCard>
        </Appear>

        {/* 社区原声 */}
        <Appear delay={280} className="px-5 pt-4">
          <Text className="mb-3 px-1 text-xs font-sans-sb uppercase tracking-wider text-primary">社区原声</Text>
          <View className="gap-3">
            {op.evidence.map((ev, i) => (
              <GlassCard key={i} className="rounded-2xl p-4">
                <Text className="text-[14px] leading-6 text-foreground">“{ev.quote}”</Text>
                <View className="mt-3 flex-row items-center justify-between">
                  <Text className="font-mono text-[12px] text-muted-foreground">
                    {ev.author} · {ev.channel}
                  </Text>
                  <View className="flex-row items-center gap-1">
                    <ArrowUp size={12} color={palette.signal} strokeWidth={2.6} />
                    <Text className="font-mono-sb text-[12px] text-signal">{compact(ev.upvotes)}</Text>
                  </View>
                </View>
              </GlassCard>
            ))}
          </View>
        </Appear>

        {/* 标签 */}
        <View className="flex-row flex-wrap gap-2 px-5 pt-5">
          {op.tags.map((t) => (
            <View key={t} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <Text className="text-[12px] font-sans-md text-muted-foreground">#{t}</Text>
            </View>
          ))}
        </View>
      </Animated.ScrollView>

      {/* 顶部悬浮栏 */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 8 }}
        className="flex-row items-center justify-between px-4"
      >
        <PressableScale scaleTo={0.88} onPress={() => router.back()}>
          <View className="h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <ChevronLeft size={22} color={palette.foreground} strokeWidth={2.4} />
          </View>
        </PressableScale>
        <SaveButton id={op.id} />
      </View>

      {/* 底部收藏 CTA */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 14, paddingHorizontal: 20 }}
      >
        <PressableScale
          scaleTo={0.97}
          onPress={() => {
            if (!saved) hapticSuccess();
            else hapticTap();
            toggleSave(op.id);
          }}
        >
          <GlassCard tone="strong" className="flex-row items-center justify-center gap-2 rounded-full py-4">
            <Text className={`text-[15px] font-sans-sb ${saved ? 'text-primary' : 'text-foreground'}`}>
              {saved ? '✓ 已收藏到灵感板' : '收藏这个机会'}
            </Text>
          </GlassCard>
        </PressableScale>
      </View>
    </View>
  );
}
