import { useAuth } from '@/auth/auth-context';
import { PersonalCenter } from '@/components/personal-center';

/** 个人中心：资料 / 安全（改密 + 会话）/ 我的权限。 */
export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null; // 受 ProtectedLayout 守卫，理论不达此
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">个人中心</h1>
      <PersonalCenter user={user} />
    </div>
  );
}
