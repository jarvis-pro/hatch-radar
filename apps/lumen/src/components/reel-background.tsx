import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/** 单场景的整屏色场：随 scrollY 在相邻场景间交叉淡入（整屏跟着聚焦场景变色）。 */
function SceneGlow({
  index,
  scrollY,
  height,
  color,
}: {
  index: number;
  scrollY: SharedValue<number>;
  height: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [(index - 1) * height, index * height, (index + 1) * height],
      [0, 1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`scene-${index}`} cx="50%" cy="24%" r="82%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.64} />
            <Stop offset="48%" stopColor={color} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#scene-${index})`} />
      </Svg>
    </Animated.View>
  );
}

/** 固定在滚动层之下的整屏色场，按场景色交叉变色（叠在极光之上）。 */
export function ReelBackground({
  colors,
  scrollY,
  height,
}: {
  colors: string[];
  scrollY: SharedValue<number>;
  height: number;
}) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {colors.map((c, i) => (
        <SceneGlow key={i} index={i} scrollY={scrollY} height={height} color={c} />
      ))}
    </View>
  );
}
