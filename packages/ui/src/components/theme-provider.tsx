'use client';

import type { ComponentProps, ReactNode } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * next-themes 封装：消费方在根 layout 包一层即可启用明暗/系统主题切换（class 策略）。
 * 用法：<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
 * 配合 components/mode-toggle.tsx 的切换按钮；`<html>` 需加 suppressHydrationWarning。
 */
// next-themes 0.4 的 ThemeProviderProps 未声明 children，这里补上
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider> & { children: ReactNode }) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
