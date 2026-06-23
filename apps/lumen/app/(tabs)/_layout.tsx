import { TabBar } from '@/components/tab-bar';
import { Tabs } from 'expo-router';

/**
 * 四 Tab 信息架构：
 *   雷达 = 实时情报流（首页 · 主秀）
 *   探索 = 手势滑卡逐条研判（收藏 / 跳过）
 *   收藏 = 灵感板（已收藏的机会）
 *   我的 = 资料 · 统计 · 主题
 * Tab 栏由自绘的玻璃浮动栏接管；场景背景透明，露出底层极光。
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tabs.Screen name="index" options={{ title: '雷达' }} />
      <Tabs.Screen name="explore" options={{ title: '探索' }} />
      <Tabs.Screen name="saved" options={{ title: '收藏' }} />
      <Tabs.Screen name="profile" options={{ title: '我的' }} />
    </Tabs>
  );
}
