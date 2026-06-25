import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronsUpDown,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Shield,
  User as UserIcon,
} from 'lucide-react';
import type { CurrentUser } from '@hatch-radar/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hatch-radar/ui/components/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@hatch-radar/ui/components/sidebar';
import { api } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { UserAvatar } from './user-avatar';

/**
 * 侧边栏页脚的用户控件：头像 + 昵称 + 角色，下拉含个人中心 / 退出。
 * 账户管理 / 审计已上移到侧边栏「系统」分组（它们是系统功能，不属于「个人」）。
 */
export function UserMenu({ user }: { user: CurrentUser }) {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const { isMobile } = useSidebar();
  const isSuper = user.role === 'super_admin';

  async function logout(): Promise<void> {
    try {
      await api.post('/account/logout');
    } catch {
      // 即便登出请求失败也清本地态并跳登录页
    }

    setUser(null);
    navigate('/login', { replace: true });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserAvatar
                user={user}
                className="size-8 rounded-md"
                fallbackClassName="rounded-md bg-primary/10 text-xs font-medium text-primary"
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {isSuper ? '超级管理员' : '普通管理员'}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            className="w-56"
            sideOffset={8}
          >
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate">{user.name}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/account/profile">
                <UserIcon /> 资料
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/security">
                <Shield /> 安全
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/sessions">
                <MonitorSmartphone /> 会话
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/permissions">
                <KeyRound /> 我的权限
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()}>
              <LogOut /> 退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
