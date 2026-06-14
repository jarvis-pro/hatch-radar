import type { Metadata } from 'next';
import { Alert, AlertDescription } from '@hatch-radar/ui/components/alert';
import { requireUser } from '@/lib/auth/guards';
import { ChangePasswordForm } from '@/components/change-password-form';

export const metadata: Metadata = { title: '修改密码' };
export const dynamic = 'force-dynamic';

/** 改密页：首登 / 被重置后强制改密在此完成（requireUser 放行本页避免死循环）。 */
export default async function PasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-lg font-semibold">修改密码</h1>
      {user.mustChangePassword ? (
        <Alert>
          <AlertDescription>为安全起见，请先设置新密码后再继续使用控制台。</AlertDescription>
        </Alert>
      ) : null}
      <ChangePasswordForm />
    </div>
  );
}
