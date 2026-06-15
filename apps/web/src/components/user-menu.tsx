import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, ScrollText, ShieldCheck, User as UserIcon } from 'lucide-react';
import { hasPermission, type CurrentUser } from '@hatch-radar/shared';
import { Avatar, AvatarFallback } from '@hatch-radar/ui/components/avatar';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hatch-radar/ui/components/dropdown-menu';
import { api } from '@/api/client';
import { useAuth } from '@/auth/auth-context';

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

/** 顶栏用户菜单：身份/角色 + 个人中心、（按权限）账户管理/审计、退出登录。 */
export function UserMenu({ user }: { user: CurrentUser }) {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const isSuper = user.role === 'super_admin';
  const canAccounts = hasPermission(user.role, user.permissions, 'accounts:manage');
  const canAudit = hasPermission(user.role, user.permissions, 'audit:view');

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } catch {
      // 即便登出请求失败也清本地态并跳登录页
    }
    setUser(null);
    navigate('/login', { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Avatar className="size-6">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline">{user.name}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span>{user.name}</span>
          <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
          <Badge variant="secondary" className="mt-1 w-fit">
            {isSuper ? '超级管理员' : '普通管理员'}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserIcon /> 个人中心
          </Link>
        </DropdownMenuItem>
        {canAccounts ? (
          <DropdownMenuItem asChild>
            <Link to="/admin/accounts">
              <ShieldCheck /> 账户管理
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canAudit ? (
          <DropdownMenuItem asChild>
            <Link to="/admin/audit">
              <ScrollText /> 审计日志
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void logout()}>
          <LogOut /> 退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
