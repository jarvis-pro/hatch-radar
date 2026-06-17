import { FunnelBars } from '@/components/funnel-bars';
import { InsightCard } from '@/components/insight-card';
import { IntensityDot } from '@/components/intensity-badge';
import { RadarMark } from '@/components/radar-mark';
import { SignalDot } from '@/components/signal-dot';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  getFunnel,
  getLocalStats,
  listInsights,
  type FunnelStats,
  type InsightListItem,
  type ListFilter,
  type LocalStats,
} from '@/db/queries';
import { timeAgo } from '@/lib/format';
import { hapticSelect } from '@/lib/haptics';
import { THEME } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { Intensity, TriageStatus } from '@hatch-radar/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, Inbox } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const INTENSITY_FILTERS: { label: string; value: Intensity | undefined; dot?: Intensity }[] = [
  { label: '全部', value: undefined },
  { label: '高强度', value: 'HIGH', dot: 'HIGH' },
  { label: '中强度', value: 'MEDIUM', dot: 'MEDIUM' },
  { label: '低强度', value: 'LOW', dot: 'LOW' },
];

const STATUS_FILTERS: { label: string; value: TriageStatus | undefined }[] = [
  { label: '全部状态', value: undefined },
  { label: '待研判', value: 'pending' },
  { label: '已入选', value: 'shortlisted' },
  { label: '已归档', value: 'archived' },
];

export default function RadarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];
  const [stats, setStats] = useState<LocalStats | null>(null);
  const [funnel, setFunnel] = useState<FunnelStats | null>(null);
  const [intensity, setIntensity] = useState<Intensity | undefined>(undefined);
  const [status, setStatus] = useState<TriageStatus | undefined>(undefined);
  const [items, setItems] = useState<InsightListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback((filter: ListFilter) => {
    setStats(getLocalStats());
    setFunnel(getFunnel());
    setItems(listInsights(filter));
  }, []);

  // 从导入/详情/研判返回时自动刷新（漏斗、徽标、待同步随之更新）
  useFocusEffect(
    useCallback(() => {
      reload({ intensity, status });
    }, [reload, intensity, status]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reload({ intensity, status });
    setRefreshing(false);
  }, [reload, intensity, status]);

  const empty = stats !== null && stats.insights === 0;
  const filtered = intensity !== undefined || status !== undefined;

  return (
    <View className="flex-1 bg-background">
      {/* 品牌头（固定，安全区内） */}
      <View style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2.5 px-4 pb-3 pt-2">
          <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-primary/15">
            <RadarMark size={20} />
          </View>
          <View className="flex-1">
            <Text className="font-sans-sb text-base leading-tight text-foreground">Signal</Text>
            <Text className="text-xs text-muted-foreground">情报伴侣</Text>
          </View>
          <ThemeToggle />
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.insight.id)}
        contentContainerClassName="gap-2.5 px-4 pb-8"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.mutedForeground}
          />
        }
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            {/* 同步状态条 */}
            <Pressable onPress={() => router.push('/sync')} className="active:opacity-80">
              <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <SignalDot online={!!stats?.lastImportAt} />
                <View className="flex-1 gap-0.5">
                  <Text className="font-sans-md text-sm text-foreground">
                    {stats?.lastImportAt ? '情报已同步' : '尚未接入工作台'}
                  </Text>
                  <Text className="font-mono text-xs text-muted-foreground">
                    {stats?.lastImportAt
                      ? `${timeAgo(stats.lastImportAt)} · 本地 ${stats.insights} 条`
                      : '回工作台局域网拉取批次'}
                  </Text>
                </View>
                {stats && stats.pendingSync > 0 ? (
                  <View className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5">
                    <Text className="font-mono text-xs text-warning">
                      {stats.pendingSync} 待推送
                    </Text>
                  </View>
                ) : (
                  <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
                )}
              </View>
            </Pressable>

            {/* 漏斗概览（点按进漏斗 Tab） */}
            {funnel && funnel.collected > 0 ? (
              <Pressable onPress={() => router.navigate('/funnel')} className="active:opacity-90">
                <View className="gap-3 rounded-xl border border-border bg-card p-4 shadow-sm shadow-black/5">
                  <View className="flex-row items-center justify-between">
                    <Text className="font-sans-sb text-sm text-foreground">研判漏斗</Text>
                    {funnel.pending > 0 ? (
                      <Text className="font-mono text-xs text-muted-foreground">
                        {funnel.pending} 待研判
                      </Text>
                    ) : null}
                  </View>
                  <FunnelBars
                    collected={funnel.collected}
                    reviewed={funnel.reviewed}
                    shortlisted={funnel.shortlisted}
                  />
                </View>
              </Pressable>
            ) : null}

            {/* 情报流 + 筛选 */}
            {!empty ? (
              <View className="gap-2 pt-1">
                <Text className="font-sans-sb text-sm text-foreground">情报流</Text>
                <FilterRow>
                  {INTENSITY_FILTERS.map((f) => (
                    <FilterChip
                      key={f.label}
                      label={f.label}
                      dot={f.dot}
                      active={intensity === f.value}
                      onPress={() => {
                        setIntensity(f.value);
                        reload({ intensity: f.value, status });
                      }}
                    />
                  ))}
                </FilterRow>
                <FilterRow>
                  {STATUS_FILTERS.map((f) => (
                    <FilterChip
                      key={f.label}
                      label={f.label}
                      active={status === f.value}
                      onPress={() => {
                        setStatus(f.value);
                        reload({ intensity, status: f.value });
                      }}
                    />
                  ))}
                </FilterRow>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View className="items-center gap-3 py-16">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Icon as={Inbox} size={24} className="text-muted-foreground" />
            </View>
            <Text className="font-sans-sb">{empty ? '本地还没有情报' : '没有符合筛选的洞察'}</Text>
            <Text className="px-8 text-center text-sm leading-5 text-muted-foreground">
              {empty
                ? '回到工作台局域网拉取批次，或导入 AirDrop 来的批次文件。'
                : '试试切换强度或研判状态筛选。'}
            </Text>
            {empty ? (
              <Button size="sm" onPress={() => router.push('/sync')}>
                <Text>去同步数据</Text>
              </Button>
            ) : filtered ? (
              <Button
                size="sm"
                variant="outline"
                onPress={() => {
                  setIntensity(undefined);
                  setStatus(undefined);
                  reload({});
                }}
              >
                <Text>清除筛选</Text>
              </Button>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <InsightCard item={item} onPress={() => router.push(`/insight/${item.insight.id}`)} />
        )}
      />
    </View>
  );
}

function FilterRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4"
      contentContainerClassName="gap-2 px-4"
    >
      {children}
    </ScrollView>
  );
}

function FilterChip({
  label,
  dot,
  active,
  onPress,
}: {
  label: string;
  dot?: Intensity;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={cn(
        'h-8 flex-row items-center gap-1.5 rounded-full border px-3 active:opacity-70',
        active ? 'border-primary bg-primary' : 'border-border bg-card',
      )}
      onPress={() => {
        hapticSelect();
        onPress();
      }}
    >
      {dot ? (
        active ? (
          <View className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
        ) : (
          <IntensityDot intensity={dot} />
        )
      ) : null}
      <Text
        className={cn(
          'font-sans-md text-sm',
          active ? 'text-primary-foreground' : 'text-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
