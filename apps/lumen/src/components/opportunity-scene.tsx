import { Text } from '@/components/ui/text';
import type { Opportunity } from '@/data/types';
import { compact, INTENSITY_META, momentumLabel } from '@/lib/format';
import { INTENSITY_GLOW, usePalette } from '@/lib/theme';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import type { EdgeInsets } from 'react-native-safe-area-context';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 整屏机会场景。内容分层视差：标题位移最大、正文次之、巨型幽灵分数最大——
 * 三层不同速率制造电影纵深。整屏可点进详情。
 */
export function OpportunityScene({
  op,
  sceneIndex,
  number,
  total,
  scrollY,
  height,
  width,
  insets,
  onPress,
}: {
  op: Opportunity;
  sceneIndex: number;
  number: number;
  total: number;
  scrollY: SharedValue<number>;
  height: number;
  width: number;
  insets: EdgeInsets;
  onPress: () => void;
}) {
  const palette = usePalette();
  const hue = INTENSITY_GLOW[op.intensity];
  const up = op.momentum >= 0;

  // 三层视差：标题 > 正文 > （巨型数字最大，单独算）
  const titleStyle = useAnimatedStyle(() => {
    const rel = scrollY.value / height - sceneIndex;
    return {
      opacity: interpolate(
        rel,
        [-0.85, -0.35, 0, 0.35, 0.85],
        [0, 1, 1, 1, 0],
        Extrapolation.CLAMP,
      ),
      transform: [{ translateY: interpolate(rel, [-1, 0, 1], [120, 0, -84], Extrapolation.CLAMP) }],
    };
  });
  const bodyStyle = useAnimatedStyle(() => {
    const rel = scrollY.value / height - sceneIndex;
    return {
      opacity: interpolate(
        rel,
        [-0.85, -0.35, 0, 0.35, 0.85],
        [0, 1, 1, 1, 0],
        Extrapolation.CLAMP,
      ),
      transform: [{ translateY: interpolate(rel, [-1, 0, 1], [62, 0, -42], Extrapolation.CLAMP) }],
    };
  });
  const numberStyle = useAnimatedStyle(() => {
    const rel = scrollY.value / height - sceneIndex;
    return {
      opacity: interpolate(rel, [-1, -0.5, 0, 0.5, 1], [0, 0.55, 1, 0.55, 0], Extrapolation.CLAMP),
      transform: [
        {
          translateY: interpolate(rel, [-1, 1], [height * 0.5, -height * 0.5], Extrapolation.CLAMP),
        },
        { scale: interpolate(rel, [-1, 0, 1], [1.3, 1, 0.78], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Pressable onPress={onPress} style={{ height, width }}>
      {/* 巨型幽灵分数 */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', right: -width * 0.05, bottom: insets.bottom + 64 },
          numberStyle,
        ]}
      >
        <Text
          style={{
            fontFamily: 'JetBrainsMono_600SemiBold',
            fontSize: width * 0.62,
            lineHeight: width * 0.62 * 1.3,
            color: hue,
            opacity: 0.16,
          }}
        >
          {op.score}
        </Text>
      </Animated.View>

      {/* 内容（三层视差） */}
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 92,
        }}
        className="px-7"
      >
        <Animated.View style={bodyStyle} className="flex-row items-center gap-3">
          <Text style={{ color: hue }} className="font-mono-sb text-[13px]">
            {pad(number)} / {pad(total)}
          </Text>
          <View
            style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline }}
          />
          <Text className="text-[12px] font-sans-md uppercase tracking-wider text-muted-foreground">
            {op.category}
          </Text>
        </Animated.View>

        <Animated.View style={titleStyle}>
          <Text className="mt-6 text-[42px] font-sans-bd leading-[1.3] text-foreground">
            {op.title}
          </Text>
        </Animated.View>

        <Animated.View style={bodyStyle}>
          <Text className="mt-5 text-[16px] leading-7 text-muted-foreground">{op.pitch}</Text>

          <View className="mt-7 flex-row items-center gap-4">
            <View
              className="flex-row items-center gap-2 rounded-full px-3 py-1.5"
              style={{
                backgroundColor: `${hue}1F`,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: `${hue}55`,
              }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hue }} />
              <Text style={{ color: hue }} className="text-[12px] font-sans-sb">
                {INTENSITY_META[op.intensity].label}
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              {up ? (
                <TrendingUp size={15} color={palette.intensityLow} strokeWidth={2.4} />
              ) : (
                <TrendingDown size={15} color={palette.mutedForeground} strokeWidth={2.4} />
              )}
              <Text
                className={`font-mono-sb text-[14px] ${up ? 'text-intensity-low' : 'text-muted-foreground'}`}
              >
                {momentumLabel(op.momentum)}
              </Text>
            </View>
          </View>

          <Text className="mt-3 font-mono text-[12px] text-muted-foreground">
            {op.channel} · 声量 {compact(op.mentions)} · {op.communities} 社区
          </Text>

          <View className="mt-9 flex-row items-center gap-2">
            <Text style={{ color: hue }} className="text-[15px] font-sans-sb">
              查看机会
            </Text>
            <ArrowRight size={17} color={hue} strokeWidth={2.6} />
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
}
