import { getMeta, setMeta } from '@/db/schema';
import { colorScheme } from 'nativewind';

/** 主题模式：跟随系统 / 强制浅色 / 强制深色（与 Web 端 next-themes 三档一致） */
export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'theme_mode';

/** 读持久化的主题模式；未设或非法值回退「跟随系统」 */
export function loadThemeMode(): ThemeMode {
  const v = getMeta(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** 落库并即时切换运行时主题（NativeWind 会通知所有 useColorScheme 消费方重渲） */
export function saveThemeMode(mode: ThemeMode): void {
  setMeta(KEY, mode);
  colorScheme.set(mode);
}

/**
 * 开机按持久化偏好应用主题。
 * 在首帧渲染前同步调用（根布局 useState 初始化器），避免「系统色 → 偏好色」闪烁。
 */
export function applyStoredThemeMode(): void {
  colorScheme.set(loadThemeMode());
}
