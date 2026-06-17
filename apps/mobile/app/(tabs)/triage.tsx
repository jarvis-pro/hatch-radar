import { InsightCard } from '@/components/insight-card';
import { Text } from '@/components/ui/text';
import { listInsights, type InsightListItem } from '@/db/queries';
import { TRIAGE_STATUS_LABELS } from '@/lib/format';
import { hapticSelect } from '@/lib/haptics';
import { THEME } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { TriageStatus } from '@hatch-radar/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';

const QUEUE_FILTERS: { label: string; value: TriageStatus }[] = [
  { label: '待研判', value: 'pending' },
  { label: '已入选', value: 'shortlisted' },
  { label: '已归档', value: 'archived' },
];

/** 研判队列：按状态聚焦待判/已入选/已归档，点进详情用 TriageEditor 处置。 */
export default function TriageScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];
  const [status, setStatus] = useState<TriageStatus>('pending');
  const [items, setItems] = useState<InsightListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback((s: TriageStatus) => {
    setItems(listInsights({ status: s }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload(status);
    }, [reload, status]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reload(status);
    setRefreshing(false);
  }, [reload, status]);

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pb-1 pt-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
        >
          {QUEUE_FILTERS.map((f) => (
            <Pressable
              key={f.value}
              onPress={() => {
                hapticSelect();
                setStatus(f.value);
                reload(f.value);
              }}
              className={cn(
                'h-8 items-center justify-center rounded-full border px-3.5 active:opacity-70',
                status === f.value ? 'border-primary bg-primary' : 'border-border bg-card',
              )}
            >
              <Text
                className={cn(
                  'font-sans-md text-sm',
                  status === f.value ? 'text-primary-foreground' : 'text-foreground',
                )}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.insight.id)}
        contentContainerClassName="gap-2.5 px-4 pb-8 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.mutedForeground}
          />
        }
        ListEmptyComponent={
          <View className="items-center gap-2 py-20">
            <Text className="font-sans-sb">
              {status === 'pending'
                ? '没有待研判的洞察'
                : `没有${TRIAGE_STATUS_LABELS[status]}的洞察`}
            </Text>
            <Text className="px-8 text-center text-sm leading-5 text-muted-foreground">
              {status === 'pending'
                ? '都研判完了，去漏斗看看转化率。'
                : '在洞察详情里可调整研判状态。'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <InsightCard item={item} onPress={() => router.push(`/insight/${item.insight.id}`)} />
        )}
      />
    </View>
  );
}
