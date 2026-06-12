import { getMeta, setMeta } from '@/db/schema';
import { colorScheme } from 'nativewind';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

/** 主题模式：跟随系统 / 强制浅色 / 强制深色（与 Web 端 next-themes 三档一致） */
export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'theme_mode';

/** 读持久化的主题模式；未设或非法值回退「跟随系统」 */
function readThemeMode(): ThemeMode {
  const v = getMeta(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

interface ThemeModeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode 必须在 <ThemeModeProvider> 内使用');
  return ctx;
}

/**
 * 主题模式中枢：持久化用户选择并驱动 NativeWind 配色（darkMode: 'class'）。
 *
 * - 'light' / 'dark'：经 NativeWind → RN Appearance override 强制配色。
 * - 'system'：清除 override 回到跟随系统。
 *
 * 关键修复：部分机型在 App「前台」切换系统明暗时不会实时派发 Appearance 事件，
 * 导致跟随系统看似失效。这里在每次回到前台时，对 system 模式强制 set('system')
 * 重新与系统对齐，覆盖事件丢失的情况。（强制 light/dark 不能绕过此问题——
 * 显式 override 会把系统观测一并锁死。）
 */
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const m = readThemeMode();
    colorScheme.set(m); // 首帧前同步应用，避免「系统色 → 偏好色」闪烁
    return m;
  });

  useEffect(() => {
    colorScheme.set(mode);
    if (mode !== 'system') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') colorScheme.set('system');
    });
    return () => sub.remove();
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setMeta(KEY, next);
    setModeState(next);
  }, []);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>{children}</ThemeModeContext.Provider>
  );
}
