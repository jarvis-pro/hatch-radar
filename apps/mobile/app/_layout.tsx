import '../global.css';

import { THEME } from '@/lib/theme';
import { ThemeModeProvider } from '@/lib/theme-mode';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { ActivityIndicator, View } from 'react-native';

export default function RootLayout() {
  return (
    <ThemeModeProvider>
      <ThemedStack />
    </ThemeModeProvider>
  );
}

// 在 Provider 内部消费 useColorScheme：首帧前 Provider 已应用持久化偏好，
// 导航头/StatusBar/TabBar 取到的即是正确配色
function ThemedStack() {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];

  // 自托管字体（@expo-google-fonts，离线打包）：每个字重独立 family，对齐 tailwind fontFamily。
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.card },
          headerTintColor: theme.primary,
          headerTitleStyle: { color: theme.foreground, fontFamily: 'Inter_600SemiBold' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="insight/[id]" options={{ title: '洞察详情' }} />
        <Stack.Screen name="sync" options={{ title: '工作台同步', presentation: 'modal' }} />
        <Stack.Screen name="activate" options={{ title: '激活设备', presentation: 'modal' }} />
      </Stack>
    </>
  );
}
