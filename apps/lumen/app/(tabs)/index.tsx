import { Appear } from '@/components/appear';
import { LiveBadge, LumenMark } from '@/components/brand';
import { Marquee } from '@/components/marquee';
import { OpportunityCarousel } from '@/components/opportunity-carousel';
import { RadarScope } from '@/components/radar-scope';
import { SectionHeader } from '@/components/section';
import { StatTile } from '@/components/stat-tile';
import { Text } from '@/components/ui/text';
import { OPPORTUNITIES, SCAN_SOURCES } from '@/data/opportunities';
import type { Opportunity } from '@/data/types';
import { hapticSelect } from '@/lib/haptics';
import { usePalette } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { Activity, Flame, Sparkles } from 'lucide-react-native';
import { useMemo } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function RadarScreen() {
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const radarSize = Math.min(width * 0.72, 300);

  const { totalSignals, high, featured } = useMemo(() => {
    const sorted = [...OPPORTUNITIES].sort((a, b) => b.score - a.score);
    return {
      totalSignals: OPPORTUNITIES.reduce((s, o) => s + o.mentions, 0),
      high: OPPORTUNITIES.filter((o) => o.intensity === 'high').length,
      featured: sorted.slice(0, 8),
    };
  }, []);

  const openOpportunity = (op: Opportunity) => {
    hapticSelect();
    router.push(`/opportunity/${op.id}`);
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: 150 }}
    >
      {/* 顶栏 */}
      <Appear from="none" duration={500} className="flex-row items-center justify-between px-5 pb-3">
        <View className="flex-row items-center gap-3">
          <LumenMark size={30} />
          <View>
            <Text className="text-[19px] font-sans-bd leading-tight text-foreground">Lumen</Text>
            <Text className="text-[11px] text-muted-foreground">AI 产品灵感雷达</Text>
          </View>
        </View>
        <LiveBadge label="实时扫描" />
      </Appear>

      {/* 实时源跑马灯 */}
      <Appear from="none" delay={80}>
        <Marquee items={SCAN_SOURCES} />
      </Appear>

      {/* 今日精选 · 视差轮播（主秀） */}
      <SectionHeader title="今日精选" trailing="左右滑动探索" />
      <Appear delay={140}>
        <OpportunityCarousel items={featured} />
      </Appear>

      {/* 脉冲统计 */}
      <Appear delay={220} className="mt-7 flex-row gap-3 px-5">
        <StatTile icon={Activity} label="今日信号" value={totalSignals} format="compact" accent={palette.signal} delay={300} />
        <StatTile icon={Sparkles} label="活跃机会" value={OPPORTUNITIES.length} accent={palette.primary} delay={400} />
        <StatTile icon={Flame} label="强信号" value={high} accent={palette.intensityHigh} delay={500} />
      </Appear>

      {/* 信号雷达 */}
      <SectionHeader title="信号雷达" trailing={`${OPPORTUNITIES.length} 簇信号`} />
      <Appear from="none" delay={180} className="items-center pt-1">
        <RadarScope size={radarSize} opportunities={OPPORTUNITIES} onSelectBlip={openOpportunity} />
        <Text className="mt-4 text-[13px] text-muted-foreground">轻点雷达上的光点展开机会</Text>
      </Appear>
    </ScrollView>
  );
}
