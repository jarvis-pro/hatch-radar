import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { hasPermission, type CurrentUser, type PermissionKey } from '@hatch-radar/shared';
import { api, setUnauthorizedHandler } from '@/api/client';

type AuthStatus = 'loading' | 'authed' | 'anon';

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  /** 重新拉取会话（登录后 / 改资料后刷新用户态）。 */
  refresh: () => Promise<void>;
  /** 直接置用户态（登录成功拿到 user 时即时生效，省一次往返）。 */
  setUser: (user: CurrentUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * 鉴权上下文：进站 GET /api/auth/session 取一次用户态（内存缓存）。
 * 任意请求 401 → 全局处理器置匿名 → 路由守卫跳 /login。前端不读 cookie（httpOnly）。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<CurrentUser | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { user } = await api.get<{ user: CurrentUser }>('/auth/session', {
        skipAuthHandler: true,
      });
      setUserState(user);
      setStatus('authed');
    } catch {
      setUserState(null);
      setStatus('anon');
    }
  }, []);

  const setUser = useCallback((next: CurrentUser | null): void => {
    setUserState(next);
    setStatus(next ? 'authed' : 'anon');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 任意请求 401 → 置匿名（路由守卫据此跳 /login）
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUserState(null);
      setStatus('anon');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, refresh, setUser }),
    [status, user, refresh, setUser],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

/** 取鉴权上下文（必须在 AuthProvider 内）。 */
export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  }
  return ctx;
}

/** 当前用户是否具备某能力（super_admin 隐式全通；未登录 / 停用即否）。仅用于 UI 显隐（权威在 server）。 */
export function can(user: CurrentUser | null, key: PermissionKey): boolean {
  return !!user && hasPermission(user.role, user.permissions, key, user.status === 'active');
}
