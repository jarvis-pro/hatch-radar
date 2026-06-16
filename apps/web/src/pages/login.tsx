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

/** 品牌区背景：同心环 + 缓慢扫掠光束（雷达隐喻，仅此处点睛）。 */
function RadarBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        viewBox="0 0 400 400"
        className="absolute top-1/2 left-1/2 size-[44rem] -translate-x-1/2 -translate-y-1/2"
        aria-hidden
      >
        <defs>
          <linearGradient id="radar-beam" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--signal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[70, 130, 190, 250].map((r) => (
          <circle
            key={r}
            cx="200"
            cy="200"
            r={r}
            fill="none"
            stroke="var(--signal)"
            strokeOpacity="0.18"
            strokeWidth="1"
          />
        ))}
        <line x1="200" y1="0" x2="200" y2="400" stroke="var(--signal)" strokeOpacity="0.12" />
        <line x1="0" y1="200" x2="400" y2="200" stroke="var(--signal)" strokeOpacity="0.12" />
        <g
          className="radar-sweep"
          style={{ transformBox: 'view-box', transformOrigin: '200px 200px' }}
        >
          <path d="M200 200 L200 0 A200 200 0 0 1 353 71 Z" fill="url(#radar-beam)" />
        </g>
        <circle cx="200" cy="200" r="3" fill="var(--signal)" />
      </svg>
    </div>
  );
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
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* 品牌区（接入仪式感，宽屏显示） */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[oklch(0.2_0.04_277)] p-12 text-white lg:flex">
        <RadarBackdrop />
        <div className="relative flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-5" />
          </span>
          Hatch Radar
        </div>
        <div className="relative space-y-3">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
            把社区噪音
            <br />
            炼成产品信号
          </h1>
          <p className="max-w-sm text-sm text-white/55">
            抓取 · AI 分析 · 闭环研判 —— 一台市场情报控制台。
          </p>
        </div>
        <div className="relative text-xs text-white/40">内部市场研究工具 · 控制台</div>
      </div>

      {/* 登录区 */}
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <span className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
              <Radar className="size-5" />
            </span>
            <CardTitle className="text-xl">登录控制台</CardTitle>
            <CardDescription>使用账户邮箱与密码接入</CardDescription>
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
    </div>
  );
}
