import '../global.css';

import { ThemeToggle } from '@/components/theme-toggle';
import { THEME } from '@/lib/theme';
import { applyStoredThemeMode } from '@/lib/theme-mode';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';

export default function RootLayout() {
  // 首帧前按持久化偏好应用主题（useState 初始化器同步执行一次，避免闪烁）
  useState(applyStoredThemeMode);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.card },
          headerTintColor: theme.primary,
          headerTitleStyle: { color: theme.foreground },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: '洞察', headerRight: () => <ThemeToggle /> }}
        />
        <Stack.Screen name="insight/[id]" options={{ title: '洞察详情' }} />
        <Stack.Screen name="sync" options={{ title: '工作台同步', presentation: 'modal' }} />
      </Stack>
    </>
  );
}
