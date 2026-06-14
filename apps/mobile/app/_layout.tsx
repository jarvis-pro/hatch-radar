import '../global.css';

import { ThemeToggle } from '@/components/theme-toggle';
import { THEME } from '@/lib/theme';
import { ThemeModeProvider } from '@/lib/theme-mode';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';

export default function RootLayout() {
  return (
    <ThemeModeProvider>
      <ThemedStack />
    </ThemeModeProvider>
  );
}

// 在 Provider 内部消费 useColorScheme：首帧前 Provider 已应用持久化偏好，
// 导航头/StatusBar 取到的即是正确配色
function ThemedStack() {
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
        <Stack.Screen name="activate" options={{ title: '激活设备', presentation: 'modal' }} />
      </Stack>
    </>
  );
}
