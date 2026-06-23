'use client';

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** 主题取值：明 / 暗 / 跟随系统。 */
export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** 用户选择（含 system）。 */
  theme: Theme;
  /** 实际生效的明暗（system 解析后的结果），供需要具体值的组件（如 sonner）使用。 */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/** localStorage 持久化键（与 index.html 的早注入脚本保持一致，避免首屏闪烁）。 */
export const THEME_STORAGE_KEY = 'hatch-radar-theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredTheme(storageKey: string, fallback: Theme): Theme {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const stored = window.localStorage.getItem(storageKey);

  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : fallback;
}

/**
 * 自带主题 Provider（去 next-themes，Vite 友好）：把 light/dark/system 写到 `<html>` 的 `dark` class
 * + localStorage，并在 system 模式下监听 `prefers-color-scheme`。配合 components/mode-toggle.tsx 切换。
 *
 * 首屏闪烁由 index.html 里的同步早注入脚本消除（在 React 挂载前就置好 class）。
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = THEME_STORAGE_KEY,
}: {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(storageKey, defaultTheme));
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    (theme === 'system' ? systemPrefersDark() : theme === 'dark') ? 'dark' : 'light',
  );

  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      const dark = theme === 'system' ? systemPrefersDark() : theme === 'dark';
      root.classList.toggle('dark', dark);
      setResolvedTheme(dark ? 'dark' : 'light');
    };

    apply();
    if (theme !== 'system') {
      return;
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);

    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme): void => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // localStorage 不可用（隐私模式 / 禁用）时仅内存生效，不阻断
      }

      setThemeState(next);
    },
    [storageKey],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/** 取主题上下文（必须在 ThemeProvider 内）。 */
export function useTheme(): ThemeContextValue {
  const ctx = use(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  }

  return ctx;
}
