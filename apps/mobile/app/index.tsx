import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import type { Insight, Intensity } from '@hatch-radar/shared';
import { getLocalStats, listInsights, type LocalStats } from '../src/db/queries';
import {
  channelLabel,
  INTENSITY_BG,
  INTENSITY_COLORS,
  INTENSITY_LABELS,
  timeAgo,
} from '../src/lib/format';

const FILTERS: { label: string; value: Intensity | undefined }[] = [
  { label: '全部', value: undefined },
  { label: '高强度', value: 'HIGH' },
  { label: '中强度', value: 'MEDIUM' },
  { label: '低强度', value: 'LOW' },
];

export default function HomeScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<LocalStats | null>(null);
  const [intensity, setIntensity] = useState<Intensity | undefined>(undefined);
  const [insights, setInsights] = useState<Insight[]>([]);

  const reload = useCallback((filter: Intensity | undefined) => {
    setStats(getLocalStats());
    setInsights(listInsights(filter));
  }, []);

  // 从导入页返回时自动刷新本地数据
  useFocusEffect(
    useCallback(() => {
      reload(intensity);
    }, [reload, intensity]),
  );

  const empty = stats !== null && stats.insights === 0;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.statsRow}>
          <Stat label="洞察" value={stats?.insights ?? 0} />
          <Stat label="帖子" value={stats?.posts ?? 0} />
          <Stat label="评论" value={stats?.comments ?? 0} />
        </View>
        <Text style={styles.lastImport}>
          {stats?.lastImportAt ? `最近导入：${timeAgo(stats.lastImportAt)}` : '尚未导入任何批次'}
        </Text>
        <Link href="/import" asChild>
          <Pressable style={styles.importBtn}>
            <Text style={styles.importBtnText}>导入批次（局域网 / 文件）</Text>
          </Pressable>
        </Link>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = intensity === f.value;
            return (
              <Pressable
                key={f.label}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => {
                  setIntensity(f.value);
                  reload(f.value);
                }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={insights}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{empty ? '本地还没有洞察' : '没有符合筛选的洞察'}</Text>
            <Text style={styles.emptyHint}>
              {empty
                ? '回到工作台局域网拉取批次，或导入 AirDrop 来的批次文件。'
                : '试试切换强度筛选。'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/insight/${item.id}`)}>
            <View style={styles.cardMeta}>
              <View style={[styles.badge, { backgroundColor: INTENSITY_BG[item.intensity] }]}>
                <Text style={[styles.badgeText, { color: INTENSITY_COLORS[item.intensity] }]}>
                  {INTENSITY_LABELS[item.intensity]}强度
                </Text>
              </View>
              <Text style={styles.metaText}>{channelLabel(item.source, item.subreddit)}</Text>
              <Text style={styles.metaText}>{timeAgo(item.createdAt)}</Text>
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.postTitle}
            </Text>
            {item.painPoints[0] ? (
              <Text style={styles.cardExcerpt} numberOfLines={2}>
                {item.painPoints[0].description}
              </Text>
            ) : null}
            <Text style={styles.cardCounts}>
              痛点 {item.painPoints.length} · 机会 {item.opportunities.length}
              {item.tags.length > 0 ? ` · ${item.tags.join(' / ')}` : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  statsRow: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    paddingVertical: 8,
    alignItems: 'center',
  },
  statNum: { fontSize: 20, fontWeight: '700', color: '#1c2330' },
  statLabel: { fontSize: 12, color: '#6b7585' },
  lastImport: { fontSize: 12, color: '#6b7585' },
  importBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  importBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  filterRow: { flexDirection: 'row', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#1c2330' },
  chipTextActive: { color: '#fff' },
  listContent: { padding: 16, gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    padding: 14,
    gap: 6,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontSize: 11.5 },
  metaText: { fontSize: 12.5, color: '#6b7585' },
  cardTitle: { fontSize: 15.5, fontWeight: '600', color: '#1c2330', lineHeight: 21 },
  cardExcerpt: { fontSize: 13.5, color: '#6b7585', lineHeight: 19 },
  cardCounts: { fontSize: 12, color: '#6b7585' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#1c2330' },
  emptyHint: { fontSize: 13, color: '#6b7585', textAlign: 'center', paddingHorizontal: 24 },
});
