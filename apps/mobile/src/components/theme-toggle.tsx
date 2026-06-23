import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { hapticSelect } from '@/lib/haptics';
import { useThemeMode, type ThemeMode } from '@/lib/theme-mode';
import { cn } from '@/lib/utils';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, View } from 'react-native';

const OPTIONS: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
];

/**
 * 头部主题切换：sun/moon 图标按钮（反映当前生效配色）→ 底部面板三档直选。
 * 选择即落库 + 即时切换；与 Web 控制台 ModeToggle 体验对齐。
 */
export function ThemeToggle() {
  const { colorScheme } = useColorScheme();
  const { mode, setMode } = useThemeMode();
  const [open, setOpen] = useState(false);

  const select = (m: ThemeMode) => {
    hapticSelect();
    setMode(m);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityLabel="切换主题"
        hitSlop={8}
        className="mr-1 h-9 w-9 items-center justify-center rounded-full active:bg-muted"
        onPress={() => setOpen(true)}
      >
        <Icon as={colorScheme === 'dark' ? Moon : Sun} size={20} className="text-foreground" />
      </Pressable>
      <ThemeSheet open={open} mode={mode} onSelect={select} onClose={() => setOpen(false)} />
    </>
  );
}

/** 底部弹出的主题选择面板（RN 核心 Modal：背景淡入 + 卡片轻微上滑） */
function ThemeSheet({
  open,
  mode,
  onSelect,
  onClose,
}: {
  open: boolean;
  mode: ThemeMode;
  onSelect: (mode: ThemeMode) => void;
  onClose: () => void;
}) {
  const translateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    if (!open) {
      return;
    }
    translateY.setValue(24);
    Animated.timing(translateY, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [open, translateY]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/40" onPress={onClose} />
        <Animated.View
          style={{ transform: [{ translateY }] }}
          className="rounded-t-3xl border-t border-border bg-popover pb-10 pt-2"
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-muted-foreground/30" />
          <Text className="px-5 py-2 text-xs font-sans-md uppercase tracking-wide text-muted-foreground">
            外观
          </Text>
          {OPTIONS.map((o) => {
            const active = mode === o.value;
            return (
              <Pressable
                key={o.value}
                className="flex-row items-center gap-3 px-5 py-3.5 active:bg-muted"
                onPress={() => onSelect(o.value)}
              >
                <Icon
                  as={o.icon}
                  size={20}
                  className={active ? 'text-primary' : 'text-foreground'}
                />
                <Text className={cn('flex-1 text-base', active && 'font-sans-sb text-primary')}>
                  {o.label}
                </Text>
                {active ? <Icon as={Check} size={18} className="text-primary" /> : null}
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </Modal>
  );
}
