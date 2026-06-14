'use client';

import { useActionState } from 'react';
import { Radar } from 'lucide-react';
import { Alert, AlertDescription } from '@hatch-radar/ui/components/alert';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hatch-radar/ui/components/card';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { loginAction } from '@/lib/auth/actions';
import type { LoginState } from '@/lib/auth/types';

/** 登录表单（密码登录；错误经 useActionState 回显）。 */
export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <Radar className="size-6 text-primary" />
        <CardTitle>登录控制台</CardTitle>
        <CardDescription>Hatch Radar</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="grid gap-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Spinner /> : null}
            登录
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
