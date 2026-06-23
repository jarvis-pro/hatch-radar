import { colorScheme } from 'nativewind';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** 主题模式：跟随系统 / 强制浅色 / 强制深色。 */
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeModeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error('useThemeMode 必须在 <ThemeModeProvider> 内使用');
  }

  return ctx;
}

/**
 * 主题模式中枢（概念体验：仅内存、不持久化）。默认强制深色——玻璃拟态在近黑底
 * 叠极光的质感最佳；用户可在「我的」页切换浅色 / 跟随系统。
 */
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    colorScheme.set('dark'); // 首帧前应用，避免浅色闪烁

    return 'dark';
  });

  useEffect(() => {
    colorScheme.set(mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>{children}</ThemeModeContext.Provider>
  );
}
