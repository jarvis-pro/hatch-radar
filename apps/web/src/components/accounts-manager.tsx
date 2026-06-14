'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import type { PermissionKey, UserRole } from '@hatch-radar/shared';
import { Alert, AlertDescription } from '@hatch-radar/ui/components/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@hatch-radar/ui/components/alert-dialog';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@hatch-radar/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hatch-radar/ui/components/dropdown-menu';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@hatch-radar/ui/components/radio-group';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@hatch-radar/ui/components/sheet';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { Switch } from '@hatch-radar/ui/components/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import {
  createUserAction,
  deleteUserAction,
  editUserAction,
  resetPasswordAction,
  setUserStatusAction,
  type ActionResult,
} from '@/lib/admin/actions';
import type { AdminUserRow } from '@/lib/admin/queries';
import type { DeviceRow, EnrollmentRow } from '@/lib/admin/device-queries';
import type { FormState } from '@/lib/auth/types';
import { DeviceManager } from './device-manager';
import { PermissionEditor } from './permission-editor';
import { timeAgo } from '@/lib/format';

interface Actor {
  id: string;
  role: UserRole;
  permissions: PermissionKey[];
}

type ConfirmKind = 'reset' | 'disable' | 'enable' | 'delete';

const CONFIRM_TEXT: Record<ConfirmKind, { title: string; desc: string; action: string }> = {
  reset: {
    title: '重置密码',
    desc: '将生成新的临时密码并踢下线，对方需用临时密码登录后改密。',
    action: '重置',
  },
  disable: {
    title: '停用账户',
    desc: '停用后该账户立即无法登录，其所有会话与设备失效。',
    action: '停用',
  },
  enable: { title: '启用账户', desc: '重新允许该账户登录。', action: '启用' },
  delete: {
    title: '删除账户',
    desc: '将永久删除该账户及其权限、会话、设备，且不可恢复。',
    action: '删除',
  },
};

/** 账户管理：列表 + 新建/编辑 Sheet + 启停/重置/删除（护栏在服务端，UI 同步置灰）。 */
export function AccountsManager({
  users,
  actor,
  devicesByUser,
  enrollmentsByUser,
}: {
  users: AdminUserRow[];
  actor: Actor;
  devicesByUser: Record<string, DeviceRow[]>;
  enrollmentsByUser: Record<string, EnrollmentRow[]>;
}) {
  const [sheet, setSheet] = useState<AdminUserRow | 'new' | null>(null);
  const [deviceSheet, setDeviceSheet] = useState<AdminUserRow | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; user: AdminUserRow } | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const activeSupers = users.filter(
    (u) => u.role === 'super_admin' && u.status === 'active',
  ).length;
  const manageable = (u: AdminUserRow) => u.role !== 'super_admin' || actor.role === 'super_admin';
  const isSelf = (u: AdminUserRow) => u.id === actor.id;
  const lastSuper = (u: AdminUserRow) => u.role === 'super_admin' && activeSupers <= 1;

  function runConfirm() {
    if (!confirm) return;
    const { kind, user } = confirm;
    start(async () => {
      setError(null);
      let res: ActionResult;
      if (kind === 'reset') res = await resetPasswordAction(user.id);
      else if (kind === 'delete') res = await deleteUserAction(user.id);
      else res = await setUserStatusAction(user.id, kind === 'disable' ? 'disabled' : 'active');
      setConfirm(null);
      if (!res.ok) {
        setError(res.error ?? '操作失败');
        return;
      }
      if (kind === 'reset' && res.tempPassword) {
        setResetResult({ email: user.email, tempPassword: res.tempPassword });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">账户管理</h1>
        <Button size="sm" className="gap-1" onClick={() => setSheet('new')}>
          <Plus className="size-4" /> 新建管理员
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>姓名 / 邮箱</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>权限</TableHead>
            <TableHead>设备</TableHead>
            <TableHead>最近登录</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </TableCell>
              <TableCell>
                <Badge variant={u.role === 'super_admin' ? 'default' : 'secondary'}>
                  {u.role === 'super_admin' ? '超级管理员' : '普通管理员'}
                </Badge>
              </TableCell>
              <TableCell>
                {u.status === 'active' ? (
                  <span className="text-sm text-muted-foreground">活跃</span>
                ) : (
                  <Badge variant="outline">停用</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {u.role === 'super_admin' ? '全部' : `${u.permissions.length} 项`}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground tabular-nums">
                {u.deviceCount > 0 ? `${u.deviceCount} 台` : '—'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {u.lastLoginAt ? timeAgo(u.lastLoginAt) : '从未'}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={!manageable(u)}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setSheet(u)}>编辑</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeviceSheet(u)}>管理设备</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setConfirm({ kind: 'reset', user: u })}>
                      重置密码
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {u.status === 'active' ? (
                      <DropdownMenuItem
                        disabled={isSelf(u) || lastSuper(u)}
                        onClick={() => setConfirm({ kind: 'disable', user: u })}
                      >
                        停用
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => setConfirm({ kind: 'enable', user: u })}>
                        启用
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={isSelf(u) || lastSuper(u)}
                      onClick={() => setConfirm({ kind: 'delete', user: u })}
                    >
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{sheet === 'new' ? '新建管理员' : '编辑管理员'}</SheetTitle>
            <SheetDescription>设置资料、角色与按能力勾选的权限。</SheetDescription>
          </SheetHeader>
          {sheet !== null ? (
            <div className="px-4 pb-4">
              <AccountForm
                target={sheet === 'new' ? null : sheet}
                actor={actor}
                onSuccess={() => setSheet(null)}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? CONFIRM_TEXT[confirm.kind].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? (
                <>
                  对 <span className="font-medium text-foreground">{confirm.user.email}</span>：
                  {CONFIRM_TEXT[confirm.kind].desc}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <Button
              variant={confirm?.kind === 'delete' ? 'destructive' : 'default'}
              disabled={pending}
              className="gap-2"
              onClick={runConfirm}
            >
              {pending ? <Spinner /> : null}
              {confirm ? CONFIRM_TEXT[confirm.kind].action : ''}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={resetResult !== null} onOpenChange={(o) => !o && setResetResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>临时密码已生成</DialogTitle>
            <DialogDescription>
              请把下面的临时密码安全地交给 {resetResult?.email}
              ，对方首次登录后须立即改密。此密码仅此一次显示。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded bg-muted px-3 py-2 font-mono text-sm break-all select-all">
            {resetResult?.tempPassword}
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={deviceSheet !== null} onOpenChange={(o) => !o && setDeviceSheet(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>设备管理 · {deviceSheet?.name}</SheetTitle>
            <SheetDescription>赋予设备、查看与强踢（凭据吊销即时生效）。</SheetDescription>
          </SheetHeader>
          {deviceSheet ? (
            <div className="px-4 pb-4">
              <DeviceManager
                userId={deviceSheet.id}
                devices={devicesByUser[deviceSheet.id] ?? []}
                enrollments={enrollmentsByUser[deviceSheet.id] ?? []}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** 新建 / 编辑表单（同一组件按 target 是否为空切换 action）。 */
function AccountForm({
  target,
  actor,
  onSuccess,
}: {
  target: AdminUserRow | null;
  actor: Actor;
  onSuccess: () => void;
}) {
  const isEdit = target != null;
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    isEdit ? editUserAction : createUserAction,
    {},
  );
  const [role, setRole] = useState<UserRole>(target?.role ?? 'admin');
  const canSuper = actor.role === 'super_admin';
  const grantable = actor.role === 'super_admin' ? undefined : actor.permissions;

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  return (
    <form action={formAction} className="grid gap-4">
      {isEdit ? <input type="hidden" name="userId" value={target.id} /> : null}

      <div className="grid gap-2">
        <Label htmlFor="email">邮箱</Label>
        {isEdit ? (
          <Input id="email" value={target.email} disabled />
        ) : (
          <Input id="email" name="email" type="email" autoComplete="off" required />
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="name">姓名</Label>
        <Input id="name" name="name" defaultValue={target?.name ?? ''} required />
      </div>

      {!isEdit ? (
        <div className="grid gap-2">
          <Label htmlFor="password">初始密码（≥8 位）</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch name="requireChange" defaultChecked />
            要求首次登录改密
          </label>
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label>角色</Label>
        <RadioGroup
          name="role"
          value={role}
          onValueChange={(v) => setRole(v as UserRole)}
          className="flex gap-4"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="admin" /> 普通管理员
          </label>
          <label
            className="flex items-center gap-2 text-sm aria-disabled:opacity-50"
            aria-disabled={!canSuper || undefined}
          >
            <RadioGroupItem value="super_admin" disabled={!canSuper} /> 超级管理员
          </label>
        </RadioGroup>
      </div>

      <div className="grid gap-2">
        <Label>权限</Label>
        <PermissionEditor
          key={`${target?.id ?? 'new'}-${role}`}
          initial={role === 'super_admin' ? [] : (target?.permissions ?? [])}
          grantable={grantable}
          disabled={role === 'super_admin'}
        />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <SheetFooter className="px-0">
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? <Spinner /> : null}
          {isEdit ? '保存' : '创建'}
        </Button>
      </SheetFooter>
    </form>
  );
}
