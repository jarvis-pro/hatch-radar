import { IntensityBadge } from '@/components/intensity-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import {
  getLocalStats,
  listInsights,
  type InsightListItem,
  type ListFilter,
  type LocalStats,
} from '@/db/queries';
import { channelLabel, timeAgo, TRIAGE_STATUS_LABELS } from '@/lib/format';
import { hapticSelect } from '@/lib/haptics';
import { THEME } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { Intensity, TriageStatus } from '@hatch-radar/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, FolderSync, Inbox, TriangleAlert } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';

const INTENSITY_FILTERS: { label: string; value: Intensity | undefined; dot?: string }[] = [
  { label: '全部', value: undefined },
  { label: '高强度', value: 'HIGH', dot: 'bg-destructive' },
  { label: '中强度', value: 'MEDIUM', dot: 'bg-warning' },
  { label: '低强度', value: 'LOW', dot: 'bg-success' },
];

const STATUS_FILTERS: { label: string; value: TriageStatus | undefined }[] = [
  { label: '全部状态', value: undefined },
  { label: '待研判', value: 'pending' },
  { label: '已入选', value: 'shortlisted' },
  { label: '已归档', value: 'archived' },
];

/** 研判状态 → 列表徽标样式（仅非 pending 展示） */
const TRIAGE_BADGE: Record<TriageStatus, { box: string; text: string }> = {
  pending: { box: 'border-border', text: 'text-muted-foreground' },
  shortlisted: { box: 'border-primary/30 bg-primary/10', text: 'text-primary' },
  archived: { box: 'border-border bg-muted', text: 'text-muted-foreground' },
};

export default function HomeScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];
  const [stats, setStats] = useState<LocalStats | null>(null);
  const [intensity, setIntensity] = useState<Intensity | undefined>(undefined);
  const [status, setStatus] = useState<TriageStatus | undefined>(undefined);
  const [items, setItems] = useState<InsightListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback((filter: ListFilter) => {
    setStats(getLocalStats());
    setItems(listInsights(filter));
  }, []);

  // 从导入/详情页返回时自动刷新本地数据（研判徽标与待同步计数随之更新）
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
    <View className="flex-1">
      <View className="gap-3 px-4 pt-3">
        {/* 本地数据概览 */}
        <Card className="gap-0 py-3 shadow-none">
          <CardContent className="flex-row items-center px-0">
            <StatCell label="洞察" value={stats?.insights ?? 0} />
            <Separator orientation="vertical" className="h-8" />
            <StatCell label="帖子" value={stats?.posts ?? 0} />
            <Separator orientation="vertical" className="h-8" />
            <StatCell label="评论" value={stats?.comments ?? 0} />
          </CardContent>
        </Card>

        {/* 同步入口（设置行样式） */}
        <Card className="gap-0 py-0 shadow-none">
          <Pressable
            className="flex-row items-center gap-3 px-4 py-3 active:opacity-70"
            onPress={() => router.push('/sync')}
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <Icon as={FolderSync} size={18} className="text-primary" />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-semibold">工作台同步</Text>
              <Text className="text-xs text-muted-foreground">
                {stats?.lastImportAt
                  ? `最近导入：${timeAgo(stats.lastImportAt)}`
                  : '尚未导入任何批次'}
              </Text>
            </View>
            <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
          </Pressable>
        </Card>

        {/* 待同步提醒 */}
        {stats && stats.pendingSync > 0 ? (
          <Pressable
            className="flex-row items-center gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 active:opacity-70"
            onPress={() => router.push('/sync')}
          >
            <Icon as={TriangleAlert} size={16} className="text-warning" />
            <Text className="flex-1 text-sm font-medium leading-5 text-warning">
              有 {stats.pendingSync} 条研判待同步，回到工作台局域网后点此推送
            </Text>
            <Icon as={ChevronRight} size={16} className="text-warning" />
          </Pressable>
        ) : null}

        {/* 筛选条（横向滚动） */}
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

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.insight.id)}
        contentContainerClassName="gap-2.5 p-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.mutedForeground}
          />
        }
        ListEmptyComponent={
          <View className="items-center gap-3 py-16">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Icon as={Inbox} size={24} className="text-muted-foreground" />
            </View>
            <Text className="font-semibold">{empty ? '本地还没有洞察' : '没有符合筛选的洞察'}</Text>
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

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 items-center gap-0.5">
      <Text className="text-xl font-bold tabular-nums">{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
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
  dot?: string;
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
        <View className={cn('h-2 w-2 rounded-full', active ? 'bg-primary-foreground' : dot)} />
      ) : null}
      <Text
        className={cn(
          'text-sm font-medium',
          active ? 'text-primary-foreground' : 'text-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function InsightCard({ item, onPress }: { item: InsightListItem; onPress: () => void }) {
  const insight = item.insight;
  const triageBadge = TRIAGE_BADGE[item.status];

  return (
    <Pressable className="active:opacity-70" onPress={onPress}>
      <Card className="gap-0 py-4 shadow-none">
        <CardContent className="gap-2 px-4">
          <View className="flex-row flex-wrap items-center gap-2">
            <IntensityBadge intensity={insight.intensity} />
            {item.status !== 'pending' ? (
              <Badge variant="outline" className={triageBadge.box}>
                <Text className={cn('text-xs font-medium', triageBadge.text)}>
                  {TRIAGE_STATUS_LABELS[item.status]}
                </Text>
              </Badge>
            ) : null}
            {item.rating != null ? (
              <Text className="text-xs font-semibold text-warning">★ {item.rating}</Text>
            ) : null}
            <View className="flex-1" />
            <Text className="text-xs text-muted-foreground">{timeAgo(insight.createdAt)}</Text>
          </View>

          <Text className="text-base font-semibold leading-snug" numberOfLines={2}>
            {insight.postTitle}
          </Text>

          {insight.painPoints[0] ? (
            <Text className="text-sm leading-5 text-muted-foreground" numberOfLines={2}>
              {insight.painPoints[0].description}
            </Text>
          ) : null}

          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {channelLabel(insight.source, insight.subreddit)} · 痛点 {insight.painPoints.length} ·
            机会 {insight.opportunities.length}
            {insight.tags.length > 0 ? ` · ${insight.tags.join(' / ')}` : ''}
          </Text>
        </CardContent>
      </Card>
    </Pressable>
  );
}
