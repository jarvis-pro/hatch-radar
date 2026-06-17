import { Text } from '@/components/ui/text';
import { View } from 'react-native';

/** 漏斗三档：采集 → 已研判 → 入选。入选档用信号青收尾（价值终点）。 */
export function FunnelBars({
  collected,
  reviewed,
  shortlisted,
}: {
  collected: number;
  reviewed: number;
  shortlisted: number;
}) {
  const max = Math.max(collected, 1);
  const rows: { label: string; value: number; bar: string; text?: string }[] = [
    { label: '采集', value: collected, bar: 'bg-primary' },
    { label: '已研判', value: reviewed, bar: 'bg-primary/55' },
    { label: '入选', value: shortlisted, bar: 'bg-signal', text: 'text-signal' },
  ];
  const conversion = collected > 0 ? Math.round((shortlisted / collected) * 100) : 0;

  return (
    <View className="gap-3">
      <View className="gap-2.5">
        {rows.map((r) => {
          const pct = r.value > 0 ? Math.max((r.value / max) * 100, 5) : 0;
          return (
            <View key={r.label} className="flex-row items-center gap-3">
              <Text className="w-12 text-xs text-muted-foreground">{r.label}</Text>
              <View className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <View className={`h-full rounded-full ${r.bar}`} style={{ width: `${pct}%` }} />
              </View>
              <Text
                className={`w-9 text-right font-mono-sb text-sm ${r.text ?? 'text-foreground'}`}
              >
                {r.value}
              </Text>
            </View>
          );
        })}
      </View>
      <Text className="font-mono text-xs text-muted-foreground">
        采集 {collected} → 入选 {shortlisted} · 转化{' '}
        <Text className="font-mono text-xs text-signal">{conversion}%</Text>
      </Text>
    </View>
  );
}
