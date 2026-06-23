import { PageHeading } from '@/components/section';
import { SwipeDeck } from '@/components/swipe-deck';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 6, paddingBottom: insets.bottom + 88 }}>
      <PageHeading eyebrow="探索" title="灵感卡组" subtitle="右滑收藏 · 左滑跳过 · 上滑展开" />
      <View className="flex-1 pt-3">
        <SwipeDeck />
      </View>
    </View>
  );
}
