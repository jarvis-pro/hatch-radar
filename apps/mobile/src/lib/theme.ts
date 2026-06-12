/**
 * 原生侧需要真实色值的少数场景用（导航头、StatusBar、RefreshControl 等
 * 接受 color prop 而非 className 的 API）。
 * 唯一色值来源是 global.css 的 CSS 变量，本文件是它的镜像 —— 改色请两边同步。
 */
export const THEME = {
  light: {
    background: 'hsl(220 20% 97%)',
    card: 'hsl(0 0% 100%)',
    foreground: 'hsl(219 26% 15%)',
    mutedForeground: 'hsl(217 11% 47%)',
    primary: 'hsl(221 83% 53%)',
    border: 'hsl(218 24% 91%)',
  },
  dark: {
    background: 'hsl(220 24% 9%)',
    card: 'hsl(217 21% 12%)',
    foreground: 'hsl(220 22% 92%)',
    mutedForeground: 'hsl(217 14% 65%)',
    primary: 'hsl(213 94% 68%)',
    border: 'hsl(219 20% 22%)',
  },
} as const;

export type ThemeColors = (typeof THEME)['light'];
