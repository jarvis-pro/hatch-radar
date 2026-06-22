import { usePalette } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewProps } from 'react-native';

interface GlassCardProps extends ViewProps {
  className?: string;
  /** 模糊强度（0–100）。留空按 tone 取默认。 */
  intensity?: number;
  /** default = 轻玻璃；strong = 更实、对比更高（前景面板用）。 */
  tone?: 'default' | 'strong';
  /** 顶部高光（玻璃边缘反光），默认开。 */
  sheen?: boolean;
}

/**
 * 玻璃面板：BlurView 背板 + 半透着色层 + 发丝描边 + 顶部高光。
 * 圆角/内边距走 className（overflow-hidden 把模糊裁进圆角）。
 * 叠在 <AuroraBackground> 之上才有「透过磨砂玻璃看见远处极光」的质感。
 */
export function GlassCard({
  children,
  className,
  style,
  intensity,
  tone = 'default',
  sheen = true,
  ...rest
}: GlassCardProps) {
  const palette = usePalette();
  const blur = intensity ?? (tone === 'strong' ? 44 : 26);
  const surface = tone === 'strong' ? palette.glass.surfaceStrong : palette.glass.surface;

  return (
    <View
      className={cn('overflow-hidden rounded-2xl', className)}
      style={[{ borderWidth: StyleSheet.hairlineWidth, borderColor: palette.glass.stroke }, style]}
      {...rest}
    >
      <BlurView intensity={blur} tint={palette.glass.tint} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: surface }]} />
      {sheen ? (
        <LinearGradient
          colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          pointerEvents="none"
          style={styles.sheen}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, height: 64 },
});
