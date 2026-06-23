import type { Intensity } from '@/data/types';
import { useColorScheme } from 'nativewind';

/** 强度光晕色（hex，供背景径向渐变 / 交叉淡入；首页轮播 / 探索卡组 / 详情头统一取用）。 */
export const INTENSITY_GLOW: Record<Intensity, string> = {
  high: '#FB6B6B',
  medium: '#F6A93D',
  low: '#45D49A',
};

/**
 * JS 侧调色板 —— 凡是 className 够不着的地方（SVG fill/stroke、LinearGradient、
 * StatusBar、原生控件）从这里取真实色值。唯一色相来源仍是 global.css 的 Signal 令牌，
 * 本文件是它在 JS 的镜像（改色两边同步）。aurora 为背景极光光斑着色。
 */
export interface Palette {
  background: string;
  card: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  /** 自适应分隔线 / 描边（深色=白透明、浅色=墨透明），替代硬编码 rgba(255,255,255,x)。 */
  hairline: string;
  hairlineSoft: string;
  /** 自适应微填充（替代 bg-white/x 在浅色下失效的问题）。 */
  fill: string;
  primary: string;
  primarySoft: string;
  signal: string;
  intensityHigh: string;
  intensityMedium: string;
  intensityLow: string;
  aurora: { color: string; opacity: number }[];
}

const PALETTE: Record<'light' | 'dark', Palette> = {
  light: {
    background: 'hsl(240 60% 99%)',
    card: 'hsl(0 0% 100%)',
    foreground: 'hsl(234 28% 12%)',
    mutedForeground: 'hsl(235 10% 44%)',
    border: 'hsl(235 16% 90%)',
    hairline: 'rgba(17,20,45,0.1)',
    hairlineSoft: 'rgba(17,20,45,0.06)',
    fill: 'rgba(17,20,45,0.04)',
    primary: 'hsl(244 76% 62%)',
    primarySoft: 'rgba(89,89,232,0.16)',
    signal: 'hsl(190 95% 40%)',
    intensityHigh: 'hsl(358 84% 58%)',
    intensityMedium: 'hsl(34 88% 52%)',
    intensityLow: 'hsl(159 72% 42%)',
    aurora: [
      { color: '#6366F1', opacity: 0.26 },
      { color: '#38BDF8', opacity: 0.2 },
      { color: '#A855F7', opacity: 0.18 },
    ],
  },
  dark: {
    background: 'hsl(234 30% 6%)',
    card: 'hsl(233 24% 10%)',
    foreground: 'hsl(230 24% 96%)',
    mutedForeground: 'hsl(232 14% 66%)',
    border: 'hsl(233 16% 22%)',
    hairline: 'rgba(255,255,255,0.12)',
    hairlineSoft: 'rgba(255,255,255,0.08)',
    fill: 'rgba(255,255,255,0.05)',
    primary: 'hsl(245 92% 72%)',
    primarySoft: 'rgba(124,118,255,0.22)',
    signal: 'hsl(188 95% 52%)',
    intensityHigh: 'hsl(1 96% 68%)',
    intensityMedium: 'hsl(36 92% 62%)',
    intensityLow: 'hsl(156 60% 54%)',
    aurora: [
      { color: '#6366F1', opacity: 0.55 },
      { color: '#22D3EE', opacity: 0.34 },
      { color: '#A855F7', opacity: 0.44 },
    ],
  },
};

/** 当前明暗下的 JS 调色板（随 colorScheme 切换重解析）。 */
export function usePalette(): Palette {
  const { colorScheme } = useColorScheme();
  return PALETTE[colorScheme === 'dark' ? 'dark' : 'light'];
}

/** 在非组件上下文取调色板（极少用；优先 usePalette）。 */
export function getPalette(scheme: 'light' | 'dark' | null | undefined): Palette {
  return PALETTE[scheme === 'dark' ? 'dark' : 'light'];
}
