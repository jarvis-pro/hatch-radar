import { PressableScale } from '@/components/pressable-scale';
import type { Opportunity } from '@/data/types';
import { EASE_SINE } from '@/lib/motion';
import { usePalette } from '@/lib/theme';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import { IntensityDot } from './intensity';

/** 极坐标 → 屏幕坐标（y 向下，angle 顺时针、0=正右）。 */
function polar(cx: number, cy: number, angleDeg: number, r: number) {
  const a = (angleDeg * Math.PI) / 180;

  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/** 中心向外扩散的脉冲环（雷达「ping」）。 */
function Ping({
  size,
  color,
  delay,
  period,
}: {
  size: number;
  color: string;
  delay: number;
  period: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: period, easing: Easing.out(Easing.ease) }), -1, false),
    );
  }, [t, delay, period]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(t.value, [0, 1], [0.12, 1]) }],
    opacity: interpolate(t.value, [0, 1], [0.55, 0]),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

interface RadarScopeProps {
  size: number;
  opportunities: Opportunity[];
  onSelectBlip: (op: Opportunity) => void;
}

/**
 * 雷达扫描仪：静态网格环 + 持续旋转的扫掠光束（彗尾渐变 + 亮前缘）+ 中心核与脉冲环
 * + 按机会分布的可点击强度光点。整屏的视觉锚点。
 */
export function RadarScope({ size, opportunities, onSelectBlip }: RadarScopeProps) {
  const palette = usePalette();
  const R = size / 2;
  const rOut = R * 0.94;
  const rings = [0.32, 0.55, 0.78, 0.94];

  // 扫掠光束：匀速旋转
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 4800, easing: Easing.linear }), -1, false);
  }, [rot]);
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));

  // 中心核轻微呼吸
  const core = useSharedValue(0);
  useEffect(() => {
    core.value = withRepeat(withTiming(1, { duration: 2400, easing: EASE_SINE }), -1, true);
  }, [core]);
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(core.value, [0, 1], [0.85, 1.15]) }],
    opacity: interpolate(core.value, [0, 1], [0.7, 1]),
  }));

  const lead = polar(R, R, 0, rOut);
  const trail = polar(R, R, 58, rOut);
  const beamPath = `M ${R} ${R} L ${lead.x} ${lead.y} A ${rOut} ${rOut} 0 0 1 ${trail.x} ${trail.y} Z`;

  return (
    <View style={{ width: size, height: size }}>
      {/* 层 1：静态网格 */}
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <RadialGradient id="radar-core-glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={palette.signal} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={palette.signal} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={R} cy={R} r={rOut} fill="url(#radar-core-glow)" />
        {rings.map((f, i) => (
          <Circle
            key={i}
            cx={R}
            cy={R}
            r={R * f}
            fill="none"
            stroke={i === rings.length - 1 ? palette.primary : palette.mutedForeground}
            strokeWidth={i === rings.length - 1 ? 1.2 : 0.8}
            strokeOpacity={i === rings.length - 1 ? 0.3 : 0.14}
          />
        ))}
        {/* 十字轴 + 对角线 */}
        {[0, 45, 90, 135].map((deg) => {
          const p1 = polar(R, R, deg, rOut);
          const p2 = polar(R, R, deg + 180, rOut);

          return (
            <Line
              key={deg}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={palette.mutedForeground}
              strokeWidth={0.7}
              strokeOpacity={0.1}
            />
          );
        })}
      </Svg>

      {/* 层 2：旋转扫掠光束 */}
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, beamStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <SvgLinearGradient
              id="radar-beam"
              gradientUnits="userSpaceOnUse"
              x1={lead.x}
              y1={lead.y}
              x2={trail.x}
              y2={trail.y}
            >
              <Stop offset="0%" stopColor={palette.signal} stopOpacity={0.42} />
              <Stop offset="100%" stopColor={palette.signal} stopOpacity={0} />
            </SvgLinearGradient>
          </Defs>
          <Path d={beamPath} fill="url(#radar-beam)" />
          <G>
            <Line
              x1={R}
              y1={R}
              x2={lead.x}
              y2={lead.y}
              stroke={palette.signal}
              strokeWidth={1.6}
              strokeOpacity={0.85}
            />
          </G>
        </Svg>
      </Animated.View>

      {/* 层 3：中心脉冲环 + 核 */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ping size={rOut * 2} color={palette.signal} delay={0} period={3200} />
        <Ping size={rOut * 2} color={palette.signal} delay={1600} period={3200} />
        <Animated.View
          style={[
            { width: 14, height: 14, borderRadius: 7, backgroundColor: palette.signal },
            coreStyle,
          ]}
        />
      </View>

      {/* 层 4：可点击光点 */}
      {opportunities.map((op) => {
        const r = op.radius * rOut;
        const p = polar(R, R, op.angle, r);
        const blip = 30;

        return (
          <PressableScale
            key={op.id}
            onPress={() => onSelectBlip(op)}
            scaleTo={0.8}
            hitSlop={8}
            style={{ position: 'absolute', left: p.x - blip / 2, top: p.y - blip / 2 }}
          >
            <View
              style={{ width: blip, height: blip, alignItems: 'center', justifyContent: 'center' }}
            >
              <IntensityDot
                intensity={op.intensity}
                size={op.intensity === 'high' ? 11 : op.intensity === 'medium' ? 9 : 7}
              />
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}
