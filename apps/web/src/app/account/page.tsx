import type { Metadata } from 'next';
import { PersonalCenter } from '@/components/personal-center';
import { requireUser } from '@/lib/auth/guards';
import { listUserSessions } from '@/lib/auth/session';
import type { PublicUser } from '@/lib/auth/types';

export const metadata: Metadata = { title: '个人中心' };
export const dynamic = 'force-dynamic';

/** 个人中心：资料 / 安全（改密 + 会话）/ 我的权限。 */
export default async function AccountPage() {
  const user = await requireUser();
  const sessions = await listUserSessions(user.id);
  const publicUser: PublicUser = {
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
  };
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">个人中心</h1>
      <PersonalCenter
        user={publicUser}
        sessions={sessions.map((s) => ({
          id: s.id,
          userAgent: s.userAgent,
          ip: s.ip,
          lastSeenAt: s.lastSeenAt,
          current: s.id === user.sessionId,
        }))}
      />
    </div>
  );
}
