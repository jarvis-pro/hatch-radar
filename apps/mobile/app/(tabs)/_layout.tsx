import { ThemeToggle } from '@/components/theme-toggle';
import { THEME } from '@/lib/theme';
import { Tabs } from 'expo-router';
import { Filter, ListChecks, Radar, User } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';

/**
 * 四 Tab 信息架构（Signal）：
 *   雷达 = 情报流（首页，自带品牌头，隐藏原生导航头）
 *   研判 = 待判队列（产品的「工作」）
 *   漏斗 = 闭环分析（采集→已研判→入选）
 *   我的 = 账户 + 工作台同步 + 设备状态
 */
export default function TabsLayout() {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.card },
        headerTintColor: theme.foreground,
        headerTitleStyle: { color: theme.foreground, fontFamily: 'Inter_600SemiBold' },
        headerShadowVisible: false,
        headerRight: () => <ThemeToggle />,
        sceneStyle: { backgroundColor: theme.background },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.mutedForeground,
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.border },
        tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '雷达',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Radar color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="triage"
        options={{
          title: '研判',
          tabBarIcon: ({ color, size }) => <ListChecks color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="funnel"
        options={{
          title: '漏斗',
          tabBarIcon: ({ color, size }) => <Filter color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
