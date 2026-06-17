import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Radar } from 'lucide-react';
import { hasPermission, type CurrentUser } from '@hatch-radar/shared';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@hatch-radar/ui/components/sidebar';
import { api } from '@/api/client';
import { UserMenu } from '@/components/user-menu';
import { NAV_GROUPS } from '@/lib/nav';

/**
 * 应用侧边栏（持久外壳的骨架）：品牌头 + 三组权限驱动导航（工作区/运营/系统）+ 用户页脚。
 * - 分组按能力过滤，整组无项则不渲染；
 * - 「队列」项展示在飞任务数徽标（信号青）；
 * - collapsible="offcanvas"：折叠即整体滑出视口，窄屏走 Sheet 抽屉（均由 Sidebar 原语处理）；
 * - position:fixed 钉在视口：整页原生滚动模型（见 layout.tsx）下，在侧栏上滑动会自然把
 *   滚动冒泡给页面、带动右侧内容上下（含触摸/惯性，浏览器原生处理，无需 JS 转发）。
 */
export function AppSidebar({ user }: { user: CurrentUser }) {
  const { pathname } = useLocation();
  const canQueue = hasPermission(user.role, user.permissions, 'analyze:run');

  // 在飞任务数（排队 + 运行中）：有 analyze:run 才轮询；入队操作 invalidate ['queue-inflight'] 即时刷新
  const inflightQ = useQuery({
    queryKey: ['queue-inflight'],
    queryFn: () => api.get<{ stats: { queued: number; running: number } }>('/analysis/jobs'),
    refetchInterval: 5000,
    enabled: canQueue,
  });
  const inflight = canQueue
    ? (inflightQ.data?.stats.queued ?? 0) + (inflightQ.data?.stats.running ?? 0)
    : 0;

  return (
    <Sidebar collapsible="offcanvas" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Hatch Radar">
              <Link to="/">
                <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Radar className="size-5" />
                </span>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-[15px] font-semibold tracking-tight">
                    Hatch Radar
                  </span>
                  <span className="truncate text-xs text-muted-foreground">Reddit 需求情报</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((it) =>
            hasPermission(user.role, user.permissions, it.perm),
          );
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((it) => {
                    const active = it.match(pathname);
                    const Icon = it.icon;
                    return (
                      <SidebarMenuItem key={it.to}>
                        <SidebarMenuButton asChild isActive={active} tooltip={it.label}>
                          <Link to={it.to}>
                            <Icon />
                            <span>{it.label}</span>
                          </Link>
                        </SidebarMenuButton>
                        {it.to === '/queue' && inflight > 0 ? (
                          <SidebarMenuBadge className="text-signal">
                            {inflight > 99 ? '99+' : inflight}
                          </SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
