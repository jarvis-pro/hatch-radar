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
import { api, ApiError, setToken } from '@/api/client';
import { useAuth } from '@/auth/auth-context';

/** 仅允许站内相对路径跳转，挡开放重定向。 */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/**
 * 全屏雷达背景：盘面 + 余晖扫掠 + 被波束扫到时点亮的回波（整页深色画布的环境层）。
 * 分层（自下而上）：盘面环/十字/声呐环 → 锥形渐变拖尾（含前缘锐利光束）→ 回波点 + 中心。
 * 核心偏左下沉于宣传语之后，外圈延展到右侧卡片之下，作为两侧的连接组织。
 */
function RadarBackdrop() {
  // 回波点：400×400 视图坐标（中心 200,200）+「被波束扫到」的时刻；延迟 = 角度 / 360 × 周期(4s)。
  const blips = [
    { cx: 277, cy: 108, delay: '0.44s' },
    { cx: 384, cy: 184, delay: '0.94s' },
    { cx: 248, cy: 282, delay: '1.67s' },
    { cx: 126, cy: 359, delay: '2.28s' },
    { cx: 61, cy: 220, delay: '2.91s' },
    { cx: 73, cy: 73, delay: '3.5s' },
  ];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 size-[52rem] -translate-x-1/2 -translate-y-1/2 lg:left-[36%]">
        {/* 盘面：同心环 + 十字线 + 周期性向外发射的声呐环 */}
        <svg viewBox="0 0 400 400" className="absolute inset-0 size-full" aria-hidden>
          {[70, 130, 190, 250].map((r) => (
            <circle
              key={r}
              cx="200"
              cy="200"
              r={r}
              fill="none"
              stroke="var(--primary)"
              strokeOpacity="0.14"
            />
          ))}
          <line x1="200" y1="0" x2="200" y2="400" stroke="var(--primary)" strokeOpacity="0.1" />
          <line x1="0" y1="200" x2="400" y2="200" stroke="var(--primary)" strokeOpacity="0.1" />
          <circle
            className="radar-emit"
            cx="200"
            cy="200"
            r="250"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="radar-emit"
            cx="200"
            cy="200"
            r="250"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            style={{ animationDelay: '2s' }}
          />
        </svg>

        {/* 余晖扫掠：锥形渐变拖尾 + 前缘锐利光束（::before），整体匀速旋转 */}
        <div className="radar-trail absolute inset-0" />

        {/* 回波：盖在扫掠之上，波束扫到时点亮并向外发出探测环，随后衰减 */}
        <svg viewBox="0 0 400 400" className="absolute inset-0 size-full" aria-hidden>
          {blips.map((b) => (
            <g key={`${b.cx}-${b.cy}`}>
              <circle
                className="radar-ping"
                cx={b.cx}
                cy={b.cy}
                r="9"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="1.5"
                style={{ animationDelay: b.delay }}
              />
              <circle
                className="radar-blip"
                cx={b.cx}
                cy={b.cy}
                r="4"
                fill="var(--primary)"
                style={{ animationDelay: b.delay }}
              />
            </g>
          ))}
          <circle
            cx="200"
            cy="200"
            r="3.5"
            fill="#fff"
            style={{ filter: 'drop-shadow(0 0 6px var(--primary))' }}
          />
        </svg>
      </div>
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
  if (status === 'authed' && user) {
    return <Navigate to={next} replace />;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    setError(null);
    setPending(true);
    try {
      const { user, token } = await api.post<{ user: CurrentUser; token: string }>('/auth/login', { email, password });
      setToken(token);
      setUser(user);
      navigate(user.mustChangePassword ? '/account/password' : next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败：服务暂时不可用，请稍后再试');
      setPending(false);
    }
  }

  return (
    <div className="dark relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* 环境层：全屏雷达，整页唯一画布 */}
      <RadarBackdrop />

      {/* 品牌（顶栏，始终可见） */}
      <header className="relative z-10 flex items-center gap-2.5 p-6 font-semibold tracking-tight lg:p-8">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Radar className="size-5" />
        </span>
        Hatch Radar
      </header>

      {/* 宣传语（左）+ 登录卡片（右）：同处一块深色画布，卡片悬浮于雷达之上 */}
      <main className="relative z-10 flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 pb-16 lg:grid-cols-2 lg:gap-12 lg:px-12">
          <div className="hidden space-y-4 lg:block">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance">
              把社区噪音
              <br />
              炼成产品信号
            </h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              抓取 · AI 分析 · 闭环研判 —— 一台市场情报控制台。
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <Card className="w-full max-w-sm border-white/10 bg-card/80 shadow-2xl backdrop-blur-xl">
              <CardHeader className="items-center text-center">
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
      </main>

      <footer className="relative z-10 p-6 text-xs text-muted-foreground lg:px-12">
        内部市场研究工具 · 控制台
      </footer>
    </div>
  );
}
