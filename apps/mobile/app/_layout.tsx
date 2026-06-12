import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: '#2563eb',
          headerTitleStyle: { color: '#1c2330' },
          contentStyle: { backgroundColor: '#f6f7f9' },
        }}
      >
        <Stack.Screen name="index" options={{ title: '洞察' }} />
        <Stack.Screen name="insight/[id]" options={{ title: '洞察详情' }} />
        <Stack.Screen name="import" options={{ title: '导入批次', presentation: 'modal' }} />
      </Stack>
    </>
  );
}
