import { Icon } from '@/components/ui/icon';
import { UserAvatar } from '@/components/user-avatar';
import { getMeta, setMeta } from '@/db/schema';
import { isEnrolled } from '@/lib/device-identity';
import { fetchMe, loadWorkstationConfig } from '@/lib/workstation';
import { useFocusEffect, useRouter } from 'expo-router';
import { CircleUserRound } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';

const CACHE_KEY = 'profile_cache';

type Cached = { name: string; avatar: string | null } | null;

/** 读「我的」页写入的资料缓存（仅取头部展示需要的 name/avatar）。 */
function readCache(): Cached {
  const raw = getMeta(CACHE_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { name?: unknown; avatar?: unknown };
    if (typeof p.name !== 'string') return null;
    return { name: p.name, avatar: typeof p.avatar === 'string' ? p.avatar : null };
  } catch {
    return null;
  }
}

/**
 * 首页头部左侧：展示当前用户头像，点按进入「我的」。
 * 头像取本地缓存（离线可用）；无缓存且已激活时后台拉一次 /api/me 播种。
 * 每次首页获得焦点重读缓存，故在「我的」改完头像返回后头部即同步。
 */
export function HeaderProfileButton() {
  const router = useRouter();
  const [cached, setCached] = useState<Cached>(() => readCache());

  useFocusEffect(
    useCallback(() => {
      const c = readCache();
      setCached(c);
      if (c || !isEnrolled()) return;
      const cfg = loadWorkstationConfig();
      if (!cfg) return;
      // 首次无缓存：联网时后台播种（失败静默，离线沿用通用图标）
      void fetchMe(cfg)
        .then((u) => {
          setMeta(
            CACHE_KEY,
            JSON.stringify({ name: u.name, email: u.email, role: u.role, avatar: u.avatar }),
          );
          setCached({ name: u.name, avatar: u.avatar });
        })
        .catch(() => {});
    }, []),
  );

  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityLabel="我的"
      className="px-1 active:opacity-60"
    >
      {cached ? (
        <UserAvatar user={cached} size={28} />
      ) : (
        <Icon as={CircleUserRound} size={24} className="text-primary" />
      )}
    </Pressable>
  );
}
