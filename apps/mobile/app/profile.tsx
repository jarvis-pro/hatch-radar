import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { UserAvatar } from '@/components/user-avatar';
import { getMeta, setMeta } from '@/db/schema';
import { randomAvatarSeeds } from '@/lib/avatar';
import { isEnrolled } from '@/lib/device-identity';
import { hapticSelect, hapticSuccess } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import {
  fetchMe,
  loadWorkstationConfig,
  updateAvatar,
  type WorkstationConfig,
} from '@/lib/workstation';
import type { CurrentUser } from '@hatch-radar/shared';
import { useFocusEffect } from 'expo-router';
import { CircleAlert, RefreshCw } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';

/** 资料页只需展示这几项；完整 CurrentUser 由 /api/me 返回。 */
type Profile = Pick<CurrentUser, 'name' | 'email' | 'role' | 'avatar'>;

const CACHE_KEY = 'profile_cache';

/** 读上次同步缓存的资料（离线时兜底展示）。 */
function readCache(): Profile | null {
  const raw = getMeta(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

function roleLabel(role: CurrentUser['role']): string {
  return role === 'super_admin' ? '超级管理员' : '普通管理员';
}

/** 个人资料：头像 + 姓名 / 角色 / 邮箱 + 更换头像（经设备通道连工作台读写）。 */
export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(() => readCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const cfg = loadWorkstationConfig();
  const ready = cfg !== null && isEnrolled();

  const load = useCallback(async () => {
    const c = loadWorkstationConfig();
    if (!c || !isEnrolled()) {
      setError('本机未激活。在「激活设备」后即可查看与同步账户资料。');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const u = await fetchMe(c);
      const p: Profile = { name: u.name, email: u.email, role: u.role, avatar: u.avatar };
      setProfile(p);
      setMeta(CACHE_KEY, JSON.stringify(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败：请确认与工作台在同一局域网');
    } finally {
      setLoading(false);
    }
  }, []);

  // 进入页面时拉取最新资料（离线则保留缓存展示 + 顶部错误条提示）
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onSaved = useCallback((avatar: string | null) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const next = { ...prev, avatar };
      setMeta(CACHE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <>
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="py-5 shadow-none">
          <CardContent className="items-center gap-3 px-4">
            <UserAvatar user={profile ?? { name: '', avatar: null }} size={80} />
            <View className="items-center gap-0.5">
              <Text className="text-lg font-semibold">{profile?.name ?? '—'}</Text>
              {profile ? (
                <Text className="text-sm text-muted-foreground">{roleLabel(profile.role)}</Text>
              ) : null}
              {profile?.email ? (
                <Text className="text-xs text-muted-foreground">{profile.email}</Text>
              ) : null}
            </View>
            <Button
              variant="outline"
              size="sm"
              onPress={() => setPickerOpen(true)}
              disabled={!ready || !profile}
            >
              <Text>更换头像</Text>
            </Button>
          </CardContent>
        </Card>

        {error ? (
          <View className="flex-row items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <Icon as={CircleAlert} size={16} className="mt-0.5 text-destructive" />
            <Text className="flex-1 text-sm leading-5 text-destructive">{error}</Text>
          </View>
        ) : null}

        {loading && !profile ? <ActivityIndicator className="mt-4" /> : null}
      </ScrollView>

      {profile && cfg ? (
        <AvatarPicker
          visible={pickerOpen}
          name={profile.name}
          current={profile.avatar}
          cfg={cfg}
          onClose={() => setPickerOpen(false)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}

/** 底部弹出的换头像选择器：随机一批候选 + 换一批 + 用首字母 + 保存。 */
function AvatarPicker({
  visible,
  name,
  current,
  cfg,
  onClose,
  onSaved,
}: {
  visible: boolean;
  name: string;
  current: string | null;
  cfg: WorkstationConfig;
  onClose: () => void;
  onSaved: (avatar: string | null) => void;
}) {
  const [seeds, setSeeds] = useState<string[]>(() => randomAvatarSeeds(12));
  const [selected, setSelected] = useState<string | null>(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await updateAvatar(cfg, selected);
      hapticSuccess();
      onSaved(selected);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败：请确认与工作台在同一局域网');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={() => {
        setSelected(current);
        setSeeds(randomAvatarSeeds(12));
        setError(null);
      }}
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <View className="gap-4 rounded-t-3xl bg-card p-5 pb-9">
          <Text className="text-lg font-semibold">更换头像</Text>

          <View className="flex-row items-center gap-4">
            <UserAvatar user={{ name, avatar: selected }} size={64} />
            <Text className="flex-1 text-sm text-muted-foreground">
              {selected ? '已选择新头像' : '当前使用昵称首字母'}
            </Text>
          </View>

          <View className="flex-row flex-wrap gap-3">
            {seeds.map((seed) => (
              <Pressable
                key={seed}
                onPress={() => {
                  hapticSelect();
                  setSelected(seed);
                }}
                className={cn(
                  'rounded-lg border-2',
                  selected === seed ? 'border-primary' : 'border-transparent',
                )}
              >
                <UserAvatar user={{ name, avatar: seed }} size={60} />
              </Pressable>
            ))}
          </View>

          <View className="flex-row items-center justify-between">
            <Button variant="ghost" size="sm" onPress={() => setSeeds(randomAvatarSeeds(12))}>
              <Icon as={RefreshCw} size={16} className="text-foreground" />
              <Text>换一批</Text>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setSelected(null)}
              disabled={selected === null}
            >
              <Text className="text-muted-foreground">用昵称首字母</Text>
            </Button>
          </View>

          {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

          <Text className="text-[11px] leading-4 text-muted-foreground">
            头像由 DiceBear 的 Adventurer 风格（Lisa Wischofsky）生成 · CC BY 4.0
          </Text>

          <View className="flex-row gap-3">
            <Button variant="outline" className="flex-1" onPress={onClose} disabled={pending}>
              <Text>取消</Text>
            </Button>
            <Button
              className="flex-1"
              onPress={() => void save()}
              disabled={pending || selected === current}
            >
              <Text>{pending ? '保存中…' : '保存'}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
