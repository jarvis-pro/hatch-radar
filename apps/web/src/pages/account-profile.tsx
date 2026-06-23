import { useState, type FormEvent } from 'react';
import { Mail, User } from 'lucide-react';
import type { CurrentUser } from '@hatch-radar/shared';
import { Alert, AlertDescription } from '@hatch-radar/ui/components/alert';
import { Button } from '@hatch-radar/ui/components/button';
import { Label } from '@hatch-radar/ui/components/label';
import { toast } from '@hatch-radar/ui/components/sonner';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { AvatarPickerDialog } from '@/components/avatar-picker-dialog';
import { IconInput } from '@/components/icon-input';
import { PageHeader } from '@/components/page-header';
import { UserAvatar } from '@/components/user-avatar';

/** 个人中心 · 资料：头像 + 邮箱（只读）+ 修改昵称。 */
export function ProfilePage() {
  const { user } = useAuth();
  if (!user) {
    return null;
  } // 受 ProtectedLayout 守卫，理论不达此

  return (
    <div>
      <PageHeader title="资料" description="你的账户基本信息" />
      <ProfileForm user={user} />
    </div>
  );
}

function ProfileForm({ user }: { user: CurrentUser }) {
  const { refresh } = useAuth();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.patch('/auth/profile', { name });
      await refresh();
      toast.success('资料已保存');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败：服务暂时不可用');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid max-w-sm gap-6">
      <div className="flex items-center gap-4">
        <UserAvatar
          user={user}
          className="size-16 rounded-md"
          fallbackClassName="rounded-md bg-primary/10 text-sm font-medium text-primary"
        />
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">{user.name}</span>
          <AvatarPickerDialog user={user} />
        </div>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="account-email">邮箱</Label>
          <IconInput icon={Mail} id="account-email" value={user.email} disabled />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="account-name">昵称</Label>
          <IconInput
            icon={User}
            id="account-name"
            placeholder="请输入昵称"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          保存
        </Button>
      </form>
    </div>
  );
}
