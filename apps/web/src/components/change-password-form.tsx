'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription } from '@hatch-radar/ui/components/alert';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { changePasswordAction } from '@/lib/auth/actions';
import type { FormState } from '@/lib/auth/types';

/** 修改密码表单（首登强制改密 / 主动改密共用）。 */
export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="current">当前密码</Label>
        <Input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">新密码（至少 8 位）</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">确认新密码</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Spinner /> : null}
        保存并继续
      </Button>
    </form>
  );
}
