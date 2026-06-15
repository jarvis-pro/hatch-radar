import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription } from '@hatch-radar/ui/components/alert';
import { Button } from '@hatch-radar/ui/components/button';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';

/** 修改密码表单（首登强制改密 / 主动改密共用；成功后刷新用户态并回首页）。 */
export function ChangePasswordForm() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setPending(true);
    try {
      await api.post('/auth/change-password', {
        current: String(f.get('current') ?? ''),
        password: String(f.get('password') ?? ''),
        confirm: String(f.get('confirm') ?? ''),
      });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改失败：服务暂时不可用，请稍后再试');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
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
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Spinner /> : null}
        保存并继续
      </Button>
    </form>
  );
}
