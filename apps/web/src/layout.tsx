import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { SidebarInset, SidebarProvider } from '@hatch-radar/ui/components/sidebar';
import { useAuth } from '@/auth/auth-context';
import { AppSidebar } from '@/components/app-sidebar';
import { TopBar } from '@/components/top-bar';

/**
 * 受保护布局（根路由守卫 + 应用外壳）：
 * - loading → 居中加载态（进站会话自检中）；
 * - 未登录 → 跳 /login?next=（细校验在 server，这里只看用户态）；
 * - 强制改密且不在改密页 → 跳 /account/password；
 * - 否则渲染持久侧边栏（按权限分组显隐）+ 上下文栏 + Outlet。
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
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset className="min-w-0">
        <TopBar user={user} />
        <div className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
