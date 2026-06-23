import { THEME } from '@/lib/theme';
import { useColorScheme } from 'nativewind';
import Svg, { Circle, Line } from 'react-native-svg';

/**
 * 品牌雷达母题徽标（与 Web 登录页 RadarBackdrop 同源的静态版）：
 * 同心环 + 扫掠线 + 中心点，色相走品牌靛紫。
 */
export function RadarMark({ size = 20 }: { size?: number }) {
  const { colorScheme } = useColorScheme();
  const c = THEME[colorScheme === 'dark' ? 'dark' : 'light'].primary;

  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Circle
        cx={10}
        cy={10}
        r={7.5}
        fill="none"
        stroke={c}
        strokeWidth={1.3}
        strokeOpacity={0.4}
      />
      <Circle cx={10} cy={10} r={4} fill="none" stroke={c} strokeWidth={1.3} strokeOpacity={0.7} />
      <Circle cx={10} cy={10} r={1.6} fill={c} />
      <Line x1={10} y1={10} x2={16} y2={5} stroke={c} strokeWidth={1.3} />
    </Svg>
  );
}
