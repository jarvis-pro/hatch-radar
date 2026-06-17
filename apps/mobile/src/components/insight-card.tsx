import { INTENSITY_BAR, IntensityBadge } from '@/components/intensity-badge';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import type { InsightListItem } from '@/db/queries';
import { channelLabel, timeAgo, TRIAGE_STATUS_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TriageStatus } from '@hatch-radar/shared';
import { Pressable, View } from 'react-native';

/** 研判状态 → 列表徽标样式（仅非 pending 展示） */
const TRIAGE_BADGE: Record<TriageStatus, { box: string; text: string }> = {
  pending: { box: 'border-border', text: 'text-muted-foreground' },
  shortlisted: { box: 'border-primary/30 bg-primary/10', text: 'text-primary' },
  archived: { box: 'border-border bg-muted', text: 'text-muted-foreground' },
};

/**
 * 洞察列表卡：左强度色条 + 强度/研判徽标 + 标题 + 痛点预览 + 等宽元数据。
 * 与 Web InsightCard 同构（左 w-1 强度条、line-clamp、mono 元数据）。
 */
export function InsightCard({ item, onPress }: { item: InsightListItem; onPress: () => void }) {
  const { insight } = item;
  const triageBadge = TRIAGE_BADGE[item.status];

  return (
    <Pressable onPress={onPress} className="active:opacity-80">
      <View className="relative overflow-hidden rounded-xl border border-border bg-card py-3.5 shadow-sm shadow-black/5">
        <View className={cn('absolute inset-y-0 left-0 w-1', INTENSITY_BAR[insight.intensity])} />
        <View className="gap-2 pl-5 pr-4">
          <View className="flex-row flex-wrap items-center gap-2">
            <IntensityBadge intensity={insight.intensity} />
            {item.status !== 'pending' ? (
              <Badge variant="outline" className={triageBadge.box}>
                <Text className={cn('text-xs font-sans-md', triageBadge.text)}>
                  {TRIAGE_STATUS_LABELS[item.status]}
                </Text>
              </Badge>
            ) : null}
            {item.rating != null ? (
              <Text className="font-mono-sb text-xs text-intensity-medium">★ {item.rating}</Text>
            ) : null}
            <View className="flex-1" />
            <Text className="font-mono text-xs text-muted-foreground">
              {timeAgo(insight.createdAt)}
            </Text>
          </View>

          <Text className="text-[15px] font-sans-sb leading-snug text-foreground" numberOfLines={2}>
            {insight.postTitle}
          </Text>

          {insight.painPoints[0] ? (
            <Text className="text-sm leading-5 text-muted-foreground" numberOfLines={2}>
              {insight.painPoints[0].description}
            </Text>
          ) : null}

          <Text className="font-mono text-xs text-muted-foreground" numberOfLines={1}>
            {channelLabel(insight.source, insight.subreddit)} · 痛点 {insight.painPoints.length} ·
            机会 {insight.opportunities.length}
            {insight.tags.length > 0 ? ` · ${insight.tags.join(' / ')}` : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
