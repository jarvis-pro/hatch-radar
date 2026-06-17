import { useEffect, type CSSProperties } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { SidebarInset, SidebarProvider } from '@hatch-radar/ui/components/sidebar';
import { useAuth } from '@/auth/auth-context';
import { AppSidebar } from '@/components/app-sidebar';
import { TopBar } from '@/components/top-bar';

/**
 * 受保护布局（根路由守卫 + 应用外壳）：
 * - loading → 居中加载态；未登录 → /login；强制改密 → /account/password；
 * - 否则渲染持久侧边栏 + 上下文栏 + Outlet。
 *
 * 外壳采用「整页原生滚动 + 顶栏吸顶」模型：SidebarProvider 仅 min-h-svh、不锁高，页面随内容
 * 由浏览器原生滚动；侧边栏 inset 浮层变体 + position:fixed 钉在视口，在侧栏上滑动时滚动自然
 * 冒泡给页面、带动内容（含触摸/惯性，浏览器原生，无需 JS 转发）。顶栏 TopBar 用 sticky top-0
 * 常驻——故 SidebarInset 不能 overflow-hidden（否则吸顶基准会变成它自身而非视口，吸顶失效）。
 */
export function ProtectedLayout() {
  const { status, user } = useAuth();
  const location = useLocation();

  // 路由切换回到顶部（整页原生滚动 → 复位 window）
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

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
    <SidebarProvider style={{ '--sidebar-width': '15rem' } as CSSProperties}>
      <AppSidebar user={user} />
      <SidebarInset className="min-w-0">
        <TopBar user={user} />
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
