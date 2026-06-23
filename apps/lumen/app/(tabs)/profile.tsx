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
import {
  Bell,
  Moon,
  RotateCcw,
  Smartphone,
  Sun,
  Vibrate,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
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

function SectionLabel({ children }: { children: string }) {
  const palette = usePalette();

  return (
    <View className="mb-5 mt-11 px-7">
      <View
        style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline }}
        className="mb-5"
      />
      <Text className="text-[12px] font-sans-sb uppercase tracking-[2px] text-primary">
        {children}
      </Text>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1">
      <Text className="font-mono-sb text-[22px] text-foreground">{value}</Text>
      <Text className="mt-1 text-[11px] text-muted-foreground">{label}</Text>
    </View>
  );
}

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
      className="relative flex-row rounded-2xl border border-border bg-foreground/5 p-1"
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
            <o.Icon
              size={15}
              color={active ? palette.primary : palette.mutedForeground}
              strokeWidth={2.3}
            />
            <Text
              className={cn(
                'text-[13px] font-sans-md',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
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
    backgroundColor: interpolateColor(p.value, [0, 1], ['rgba(128,130,150,0.5)', palette.primary]),
  }));
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(p.value, [0, 1], [2, 20]) }],
  }));

  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        onChange(!value);
      }}
    >
      <Animated.View
        style={[track, { width: 46, height: 28, borderRadius: 14, justifyContent: 'center' }]}
      >
        <Animated.View
          style={[knob, { width: 24, height: 24, borderRadius: 12, backgroundColor: 'white' }]}
        />
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
    <View className="flex-row items-center gap-3 py-4">
      <Icon size={18} color={palette.mutedForeground} strokeWidth={2.2} />
      <View className="flex-1">
        <Text className="text-[15px] font-sans-md text-foreground">{label}</Text>
        <Text className="text-[12px] text-muted-foreground">{hint}</Text>
      </View>
      <GlassSwitch value={value} onChange={onChange} />
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

      {/* 资料 */}
      <View className="mt-3 flex-row items-center gap-4 px-7">
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
          <Text className="text-[22px] font-sans-bd text-foreground">灵感探索者</Text>
          <Text className="text-[12.5px] text-muted-foreground">Lumen 概念体验 · 早期成员</Text>
        </View>
      </View>

      {/* 统计 */}
      <View className="mt-8 flex-row items-start px-7">
        <Stat value={savedIds.length} label="收藏" />
        <View
          style={{
            width: StyleSheet.hairlineWidth,
            backgroundColor: palette.hairline,
            marginHorizontal: 16,
          }}
        />
        <Stat value={dismissedIds.length} label="已跳过" />
        <View
          style={{
            width: StyleSheet.hairlineWidth,
            backgroundColor: palette.hairline,
            marginHorizontal: 16,
          }}
        />
        <Stat value={OPPORTUNITIES.length} label="追踪机会" />
      </View>

      {/* 外观 */}
      <SectionLabel>外观</SectionLabel>
      <View className="px-7">
        <ThemeSegmented />
      </View>

      {/* 偏好 */}
      <SectionLabel>偏好</SectionLabel>
      <View className="px-7">
        <PrefRow
          icon={Bell}
          label="强信号提醒"
          hint="出现高强度机会时推送"
          value={notify}
          onChange={setNotify}
        />
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.hairlineSoft }} />
        <PrefRow
          icon={Vibrate}
          label="触感反馈"
          hint="交互时的轻微震动"
          value={haptics}
          onChange={setHaptics}
        />
      </View>

      {/* 关于 */}
      <SectionLabel>关于</SectionLabel>
      <View className="px-7">
        <Text className="text-[15px] leading-7 text-foreground">
          Lumen 是一个 AI
          产品灵感雷达的概念体验：持续扫描社区信号，把浮现中的产品机会与用户痛点提炼成可探索的卡片。
        </Text>
        <Text className="mt-3 text-[13px] leading-6 text-muted-foreground">
          本应用的全部数据均为演示用 mock，不发起任何网络请求。
        </Text>
        <Pressable
          onPress={() => {
            hapticSelect();
            reset();
            restoreDeck();
          }}
          className="mt-7 flex-row items-center gap-2.5"
        >
          <RotateCcw size={16} color={palette.mutedForeground} strokeWidth={2.3} />
          <Text className="text-[14px] font-sans-md text-muted-foreground">重置演示数据</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
