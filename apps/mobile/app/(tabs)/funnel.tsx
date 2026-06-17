import { FunnelBars } from '@/components/funnel-bars';
import { INTENSITY_BAR } from '@/components/intensity-badge';
import { Text } from '@/components/ui/text';
import { getFunnel, type FunnelStats } from '@/db/queries';
import { INTENSITY_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Intensity } from '@hatch-radar/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

const INTENSITY_ORDER: Intensity[] = ['HIGH', 'MEDIUM', 'LOW'];

export default function FunnelScreen() {
  const [funnel, setFunnel] = useState<FunnelStats | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFunnel(getFunnel());
    }, []),
  );

  if (!funnel || funnel.collected === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-10">
        <Text variant="muted" className="text-center leading-6">
          导入批次后，这里按「采集 → 已研判 → 入选」展示闭环漏斗，以及强度与版块分布。
        </Text>
      </View>
    );
  }

  const intensityMax = Math.max(...INTENSITY_ORDER.map((k) => funnel.byIntensity[k]), 1);
  const sourceMax = Math.max(...funnel.bySource.map((s) => s.count), 1);

  return (
    <ScrollView
      className="bg-background"
      contentContainerClassName="gap-3 p-4 pb-8"
      showsVerticalScrollIndicator={false}
    >
      <Section title="研判漏斗">
        <FunnelBars
          collected={funnel.collected}
          reviewed={funnel.reviewed}
          shortlisted={funnel.shortlisted}
        />
      </Section>

      <View className="flex-row gap-3">
        <StatTile label="待研判" value={funnel.pending} />
        <StatTile label="已入选" value={funnel.shortlisted} accent="text-signal" />
        <StatTile label="已归档" value={funnel.archived} />
      </View>

      <Section title="强度分布">
        {INTENSITY_ORDER.map((k) => (
          <DistRow
            key={k}
            label={`${INTENSITY_LABELS[k]}强度`}
            value={funnel.byIntensity[k]}
            max={intensityMax}
            bar={INTENSITY_BAR[k]}
          />
        ))}
      </Section>

      {funnel.bySource.length > 0 ? (
        <Section title="版块分布">
          {funnel.bySource.map((s) => (
            <DistRow
              key={s.label}
              label={s.label}
              value={s.count}
              max={sourceMax}
              bar="bg-primary"
              mono
            />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4 shadow-sm shadow-black/5">
      <Text className="font-sans-sb text-sm text-foreground">{title}</Text>
      {children}
    </View>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <View className="flex-1 gap-1 rounded-xl border border-border bg-card p-3 shadow-sm shadow-black/5">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className={cn('font-mono-sb text-2xl', accent ?? 'text-foreground')}>{value}</Text>
    </View>
  );
}

function DistRow({
  label,
  value,
  max,
  bar,
  mono,
}: {
  label: string;
  value: number;
  max: number;
  bar: string;
  mono?: boolean;
}) {
  const pct = value > 0 ? Math.max((value / max) * 100, 5) : 0;
  return (
    <View className="flex-row items-center gap-3">
      <Text
        className={cn('w-20 text-xs text-muted-foreground', mono && 'font-mono')}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
        <View className={cn('h-full rounded-full', bar)} style={{ width: `${pct}%` }} />
      </View>
      <Text className="w-9 text-right font-mono-sb text-sm text-foreground">{value}</Text>
    </View>
  );
}
