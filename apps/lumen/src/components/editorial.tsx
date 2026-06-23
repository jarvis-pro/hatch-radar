import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/** 整屏强度色场（静态径向光晕，单色屏用：详情 / 探索）。叠在极光之上。 */
export function HueWash({ color, opacity = 0.5 }: { color: string; opacity?: number }) {
  const id = `wash-${color.replace('#', '')}`;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="22%" r="85%">
            <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
            <Stop offset="50%" stopColor={color} stopOpacity={opacity * 0.28} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
