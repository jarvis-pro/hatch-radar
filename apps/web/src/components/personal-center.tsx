'use client';

import { useActionState, useTransition } from 'react';
import { Check, Minus } from 'lucide-react';
import { PERMISSION_CATALOG, PERMISSION_GROUPS, hasPermission } from '@hatch-radar/shared';
import { Alert, AlertDescription } from '@hatch-radar/ui/components/alert';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hatch-radar/ui/components/tabs';
import {
  revokeOtherSessionsAction,
  revokeSessionAction,
  updateOwnNameAction,
} from '@/lib/admin/actions';
import type { FormState, PublicUser } from '@/lib/auth/types';
import { ChangePasswordForm } from './change-password-form';
import { timeAgo } from '@/lib/format';

interface SessionRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  lastSeenAt: number;
  current: boolean;
}

/** 个人中心：资料（改名）/ 安全（改密 + 会话）/ 我的权限（只读）。 */
export function PersonalCenter({ user, sessions }: { user: PublicUser; sessions: SessionRow[] }) {
  return (
    <Tabs defaultValue="profile" className="space-y-4">
      <TabsList>
        <TabsTrigger value="profile">资料</TabsTrigger>
        <TabsTrigger value="security">安全</TabsTrigger>
        <TabsTrigger value="permissions">我的权限</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <ProfileForm name={user.name} email={user.email} />
      </TabsContent>

      <TabsContent value="security" className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-medium">修改密码</h2>
          <ChangePasswordForm />
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-medium">活跃会话</h2>
          <SessionList sessions={sessions} />
        </section>
      </TabsContent>

      <TabsContent value="permissions">
        <MyPermissions user={user} />
      </TabsContent>
    </Tabs>
  );
}

function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateOwnNameAction, {});
  return (
    <form action={action} className="grid max-w-sm gap-4">
      <div className="grid gap-2">
        <Label htmlFor="account-email">邮箱</Label>
        <Input id="account-email" value={email} disabled />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="account-name">姓名</Label>
        <Input id="account-name" name="name" defaultValue={name} required />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok ? (
        <Alert>
          <AlertDescription>已保存。</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Spinner /> : null}
        保存
      </Button>
    </form>
  );
}

function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const [pending, start] = useTransition();
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
        >
          <div className="min-w-0">
            <div className="truncate">
              {s.userAgent ?? '未知设备'}
              {s.current ? <span className="ml-2 text-xs text-primary">（本次）</span> : null}
            </div>
            <div className="text-xs text-muted-foreground">
              {s.ip ? `${s.ip} · ` : ''}
              {timeAgo(s.lastSeenAt)}活跃
            </div>
          </div>
          {!s.current ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => start(() => revokeSessionAction(s.id).then(() => undefined))}
            >
              登出
            </Button>
          ) : null}
        </div>
      ))}
      {others > 0 ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => start(() => revokeOtherSessionsAction().then(() => undefined))}
        >
          登出其他所有会话
        </Button>
      ) : null}
    </div>
  );
}

function MyPermissions({ user }: { user: PublicUser }) {
  if (user.role === 'super_admin') {
    return (
      <p className="text-sm text-muted-foreground">
        你是<span className="font-medium text-foreground">超级管理员</span>，隐式拥有全部能力。
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group} className="grid gap-1">
          <div className="text-xs font-medium text-muted-foreground">{group}</div>
          {PERMISSION_CATALOG.filter((c) => c.group === group).map((c) => {
            const granted = hasPermission(user.role, user.permissions, c.key);
            return (
              <div key={c.key} className="flex items-center gap-2 text-sm">
                {granted ? (
                  <Check className="size-4 text-primary" />
                ) : (
                  <Minus className="size-4 text-muted-foreground/50" />
                )}
                <span className={granted ? '' : 'text-muted-foreground/60'}>{c.label}</span>
                {c.sensitive ? (
                  <Badge variant="outline" className="text-[10px]">
                    敏感
                  </Badge>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
