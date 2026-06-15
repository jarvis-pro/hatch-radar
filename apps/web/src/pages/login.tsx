import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Radar } from 'lucide-react';
import type { CurrentUser } from '@hatch-radar/shared';
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
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';

/** 仅允许站内相对路径跳转，挡开放重定向。 */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/** 登录页（密码登录；成功后 server Set-Cookie，前端置用户态并跳转）。 */
export function LoginPage() {
  const { status, user, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const next = safeNext(params.get('next'));

  // 已登录访问 /login → 回目标页（替代原 middleware 行为）
  if (status === 'authed' && user) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    setError(null);
    setPending(true);
    try {
      const { user } = await api.post<{ user: CurrentUser }>('/auth/login', { email, password });
      setUser(user);
      navigate(user.mustChangePassword ? '/account/password' : next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败：服务暂时不可用，请稍后再试');
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Radar className="size-6 text-primary" />
          <CardTitle>登录控制台</CardTitle>
          <CardDescription>Hatch Radar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
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
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Spinner /> : null}
              登录
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
