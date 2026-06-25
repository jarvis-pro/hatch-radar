import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { hasPermission, type CurrentUser, type PermissionKey } from '@hatch-radar/shared';
import { api, getToken, setToken, setUnauthorizedHandler } from '@/api/client';

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
 * 鉴权上下文：进站若有本地 token 则 GET /api/account/session 验证（内存缓存）。
 * 任意请求 401 → 全局处理器清 token + 置匿名 → 路由守卫跳 /login。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<CurrentUser | null>(null);
  // ref 避免 401 handler 闭包里读到过期的 status
  const statusRef = useRef<AuthStatus>('loading');

  const refresh = useCallback(async (): Promise<void> => {
    if (!getToken()) {
      setUserState(null);
      setStatus('anon');

      return;
    }

    try {
      const { user } = await api.get<{ user: CurrentUser }>('/account/session', {
        skipAuthHandler: true,
      });
      setUserState(user);
      setStatus('authed');
    } catch {
      setToken(null);
      setUserState(null);
      setStatus('anon');
    }
  }, []);

  const setUser = useCallback((next: CurrentUser | null): void => {
    if (!next) {
      setToken(null);
    }

    setUserState(next);
    setStatus(next ? 'authed' : 'anon');
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 登录态心跳：每 30s 探活一次，SSO 顶掉旧会话后下次心跳即收到 401 被踢出
  useEffect(() => {
    if (status !== 'authed') {
      return;
    }

    const id = setInterval(() => {
      void api.get('/account/session').catch(() => undefined);
    }, 30_000);

    return () => clearInterval(id);
  }, [status]);

  // 任意请求 401 → 清 token + 置匿名（路由守卫据此跳 /login）
  // 若来自已登录态（如被 SSO 顶掉），写 sessionStorage 标记供登录页展示提示
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (statusRef.current === 'authed') {
        sessionStorage.setItem('auth:expired', '1');
      }

      setToken(null);
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
