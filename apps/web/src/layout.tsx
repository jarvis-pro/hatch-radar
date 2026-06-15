import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Radar } from 'lucide-react';
import { ModeToggle } from '@hatch-radar/ui/components/mode-toggle';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { useAuth } from '@/auth/auth-context';
import { SiteNav } from '@/components/site-nav';
import { UserMenu } from '@/components/user-menu';

/**
 * 受保护布局（根路由守卫）：
 * - loading → 居中加载态（进站会话自检中）；
 * - 未登录 → 跳 /login?next=（细校验在 server，这里只看用户态）；
 * - 强制改密且不在改密页 → 跳 /account/password；
 * - 否则渲染顶栏（按权限显隐导航）+ Outlet。
 */
export function ProtectedLayout() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }
  if (status === 'anon' || !user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (user.mustChangePassword && location.pathname !== '/account/password') {
    return <Navigate to="/account/password" replace />;
  }

  return (
    <div className="flex min-h-dvh flex-col antialiased">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Radar className="size-5 text-primary" />
            Hatch Radar
          </Link>
          <div className="flex items-center gap-1">
            <SiteNav user={user} />
            <ModeToggle />
            <UserMenu user={user} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground">
          控制台 · 数据由工作台 server 进程（爬取 + AI 分析）产出
        </div>
      </footer>
    </div>
  );
}
