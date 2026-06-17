/**
 * 原生侧需要真实色值的少数场景用（导航头、StatusBar、RefreshControl、TabBar 等
 * 接受 color prop 而非 className 的 API）。
 * 唯一色值来源是 global.css 的 CSS 变量，本文件是它的镜像 —— 改色请两边同步。
 * 设计系统「Signal」：品牌靛紫 + 信号青，与 Web @hatch-radar/ui 同构。
 */
export const THEME = {
  light: {
    background: 'hsl(230 78% 99%)',
    card: 'hsl(0 0% 100%)',
    foreground: 'hsl(231 21% 11%)',
    mutedForeground: 'hsl(230 8% 43%)',
    primary: 'hsl(240 76% 63%)',
    signal: 'hsl(190 100% 36%)',
    border: 'hsl(230 14% 89%)',
  },
  dark: {
    background: 'hsl(231 19% 7%)',
    card: 'hsl(231 16% 10%)',
    foreground: 'hsl(230 18% 94%)',
    mutedForeground: 'hsl(230 10% 65%)',
    primary: 'hsl(238 95% 70%)',
    signal: 'hsl(189 100% 44%)',
    border: 'hsl(230 8% 19%)',
  },
} as const;

export type ThemeColors = (typeof THEME)['light'];
