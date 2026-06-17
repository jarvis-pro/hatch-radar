import { ChangePasswordForm } from '@/components/change-password-form';
import { PageHeader } from '@/components/page-header';

/** 个人中心 · 安全：修改密码。 */
export function SecurityPage() {
  return (
    <div>
      <PageHeader title="安全" description="修改登录密码" />
      <div className="max-w-sm">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
