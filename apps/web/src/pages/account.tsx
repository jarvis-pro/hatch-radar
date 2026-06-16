import { useAuth } from '@/auth/auth-context';
import { PageHeader } from '@/components/page-header';
import { PersonalCenter } from '@/components/personal-center';

/** 个人中心：资料 / 安全（改密 + 会话）/ 我的权限。 */
export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null; // 受 ProtectedLayout 守卫，理论不达此
  return (
    <div>
      <PageHeader title="个人中心" description="资料 · 安全（改密与会话）· 我的权限" />
      <PersonalCenter user={user} />
    </div>
  );
}
