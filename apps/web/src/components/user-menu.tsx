'use client';

import Link from 'next/link';
import { ChevronDown, LogOut, ScrollText, ShieldCheck, User as UserIcon } from 'lucide-react';
import { hasPermission } from '@hatch-radar/shared';
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
import { logoutAction } from '@/lib/auth/actions';
import type { PublicUser } from '@/lib/auth/types';

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

/** 顶栏用户菜单：身份/角色 + 个人中心、（按权限）账户管理/审计、退出登录。 */
export function UserMenu({ user }: { user: PublicUser }) {
  const isSuper = user.role === 'super_admin';
  const canAccounts = hasPermission(user.role, user.permissions, 'accounts:manage');
  const canAudit = hasPermission(user.role, user.permissions, 'audit:view');
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
          <Link href="/account">
            <UserIcon /> 个人中心
          </Link>
        </DropdownMenuItem>
        {canAccounts ? (
          <DropdownMenuItem asChild>
            <Link href="/admin/accounts">
              <ShieldCheck /> 账户管理
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canAudit ? (
          <DropdownMenuItem asChild>
            <Link href="/admin/audit">
              <ScrollText /> 审计日志
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="flex w-full">
              <LogOut /> 退出登录
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
