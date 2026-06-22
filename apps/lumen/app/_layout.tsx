import '../global.css';

import { AuroraBackground } from '@/components/aurora-background';
import { StoreProvider } from '@/lib/store';
import { usePalette } from '@/lib/theme';
import { ThemeModeProvider } from '@/lib/theme-mode';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * 导航主题：背景设为透明，让导航器不再绘制不透明的主题底色，从而露出底层 <AuroraBackground>。
 * （否则 expo-router 默认浅色主题会铺一层 rgb(242,242,242) 盖住极光。）
 */
const NAV_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent' },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeModeProvider>
          <StoreProvider>
            <AppShell />
          </StoreProvider>
        </ThemeModeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  const palette = usePalette();

  // 自托管字体（@expo-google-fonts，离线打包）：每个字重独立 family，对齐 tailwind。
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <AuroraBackground />
      <StatusBar style="light" />
      <ThemeProvider value={NAV_THEME}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: 'transparent' },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="opportunity/[id]" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
      </ThemeProvider>
    </View>
  );
}
