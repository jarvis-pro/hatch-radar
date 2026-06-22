import { Appear } from '@/components/appear';
import { GlassCard } from '@/components/glass';
import { PageHeading } from '@/components/section';
import { Text } from '@/components/ui/text';
import { OPPORTUNITIES } from '@/data/opportunities';
import { hapticSelect } from '@/lib/haptics';
import { SPRING, SPRING_SOFT } from '@/lib/motion';
import { useStore } from '@/lib/store';
import { usePalette } from '@/lib/theme';
import { useThemeMode, type ThemeMode } from '@/lib/theme-mode';
import { cn } from '@/lib/utils';
import { LinearGradient } from 'expo-linear-gradient';
import { Bell, Bookmark, Info, ListChecks, Moon, RotateCcw, Smartphone, Sun, Vibrate } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const THEME_OPTIONS: { key: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { key: 'light', label: '浅色', Icon: Sun },
  { key: 'dark', label: '深色', Icon: Moon },
  { key: 'system', label: '跟随', Icon: Smartphone },
];

function ThemeSegmented() {
  const { mode, setMode } = useThemeMode();
  const palette = usePalette();
  const [w, setW] = useState(0);
  const idx = THEME_OPTIONS.findIndex((o) => o.key === mode);
  const seg = w > 0 ? (w - 8) / THEME_OPTIONS.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    x.value = withSpring(idx * seg, SPRING_SOFT);
  }, [idx, seg, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      className="relative flex-row rounded-2xl border border-white/10 bg-white/5 p-1"
    >
      {seg > 0 ? (
        <Animated.View
          className="rounded-xl border border-primary/30 bg-primary/20"
          style={[{ position: 'absolute', top: 4, bottom: 4, left: 4, width: seg }, pill]}
        />
      ) : null}
      {THEME_OPTIONS.map((o) => {
        const active = o.key === mode;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              hapticSelect();
              setMode(o.key);
            }}
            className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5"
          >
            <o.Icon size={15} color={active ? palette.primary : palette.mutedForeground} strokeWidth={2.3} />
            <Text className={cn('text-[13px] font-sans-md', active ? 'text-primary' : 'text-muted-foreground')}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function GlassSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const palette = usePalette();
  const p = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    p.value = withSpring(value ? 1 : 0, SPRING);
  }, [value, p]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], ['rgba(255,255,255,0.12)', palette.primary]),
  }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(p.value, [0, 1], [2, 20]) }] }));
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        onChange(!value);
      }}
    >
      <Animated.View style={[track, { width: 46, height: 28, borderRadius: 14, justifyContent: 'center' }]}>
        <Animated.View style={[knob, { width: 24, height: 24, borderRadius: 12, backgroundColor: 'white' }]} />
      </Animated.View>
    </Pressable>
  );
}

function PrefRow({
  icon: Icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-3 py-2.5">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-white/5">
        <Icon size={17} color={palette.mutedForeground} strokeWidth={2.2} />
      </View>
      <View className="flex-1">
        <Text className="text-[14px] font-sans-md text-foreground">{label}</Text>
        <Text className="text-[11.5px] text-muted-foreground">{hint}</Text>
      </View>
      <GlassSwitch value={value} onChange={onChange} />
    </View>
  );
}

function MiniStat({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  const palette = usePalette();
  return (
    <View className="flex-1 items-center">
      <Icon size={18} color={palette.primary} strokeWidth={2.2} />
      <Text className="mt-1.5 font-mono-sb text-xl text-foreground">{value}</Text>
      <Text className="text-[11px] text-muted-foreground">{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { savedIds, dismissedIds, restoreDeck, reset } = useStore();
  const [notify, setNotify] = useState(true);
  const [haptics, setHaptics] = useState(true);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 120 }}
    >
      <PageHeading eyebrow="我的" title="个人空间" />

      {/* 资料卡 */}
      <Appear delay={40} className="px-5 pt-2">
        <GlassCard className="rounded-[28px] p-5">
          <View className="flex-row items-center gap-4">
            <View className="h-16 w-16 overflow-hidden rounded-full">
              <LinearGradient
                colors={['#7C76FF', '#22D3EE']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text className="text-2xl font-sans-bd text-white">灵</Text>
              </LinearGradient>
            </View>
            <View className="flex-1">
              <Text className="text-lg font-sans-bd text-foreground">灵感探索者</Text>
              <Text className="text-[12.5px] text-muted-foreground">Lumen 概念体验 · 早期成员</Text>
            </View>
          </View>

          <View className="mt-5 flex-row border-t border-white/10 pt-4">
            <MiniStat icon={Bookmark} value={savedIds.length} label="收藏" />
            <View className="w-px bg-white/10" />
            <MiniStat icon={ListChecks} value={dismissedIds.length} label="已跳过" />
            <View className="w-px bg-white/10" />
            <MiniStat icon={Info} value={OPPORTUNITIES.length} label="追踪机会" />
          </View>
        </GlassCard>
      </Appear>

      {/* 外观 */}
      <Appear delay={120} className="px-5 pt-4">
        <Text className="mb-2.5 px-1 text-xs font-sans-sb uppercase tracking-wider text-muted-foreground">外观</Text>
        <GlassCard className="rounded-[24px] p-4">
          <ThemeSegmented />
        </GlassCard>
      </Appear>

      {/* 偏好 */}
      <Appear delay={200} className="px-5 pt-4">
        <Text className="mb-2.5 px-1 text-xs font-sans-sb uppercase tracking-wider text-muted-foreground">偏好</Text>
        <GlassCard className="rounded-[24px] px-4 py-1.5">
          <PrefRow icon={Bell} label="强信号提醒" hint="出现高强度机会时推送" value={notify} onChange={setNotify} />
          <View className="h-px bg-white/8" />
          <PrefRow icon={Vibrate} label="触感反馈" hint="交互时的轻微震动" value={haptics} onChange={setHaptics} />
        </GlassCard>
      </Appear>

      {/* 关于 */}
      <Appear delay={280} className="px-5 pt-4">
        <Text className="mb-2.5 px-1 text-xs font-sans-sb uppercase tracking-wider text-muted-foreground">关于</Text>
        <GlassCard className="rounded-[24px] p-5">
          <Text className="text-[14px] leading-6 text-foreground">
            Lumen 是一个 AI 产品灵感雷达的概念体验：持续扫描社区信号，把浮现中的产品机会与用户痛点提炼成可探索的卡片。
          </Text>
          <Text className="mt-3 text-[12.5px] leading-5 text-muted-foreground">
            本应用的全部数据均为演示用 mock，不发起任何网络请求。
          </Text>
          <Pressable
            onPress={() => {
              hapticSelect();
              reset();
              restoreDeck();
            }}
            className="mt-5 flex-row items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3"
          >
            <RotateCcw size={16} color={palette.mutedForeground} strokeWidth={2.3} />
            <Text className="text-[13.5px] font-sans-md text-muted-foreground">重置演示数据</Text>
          </Pressable>
        </GlassCard>
      </Appear>
    </ScrollView>
  );
}
