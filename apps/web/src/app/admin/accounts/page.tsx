import type { Metadata } from 'next';
import { AccountsManager } from '@/components/accounts-manager';
import { DbSetupNotice } from '@/components/empty';
import { Forbidden } from '@/components/forbidden';
import { requirePermission } from '@/lib/auth/guards';
import { listUsers } from '@/lib/admin/queries';
import { tryGetDb } from '@/lib/db';

export const metadata: Metadata = { title: '账户管理' };
export const dynamic = 'force-dynamic';

/** 账户管理（accounts:manage）：建号 / 改权限 / 启停 / 重置 / 删除。 */
export default async function AccountsPage() {
  const { user, allowed } = await requirePermission('accounts:manage');
  if (!allowed) return <Forbidden />;
  const db = await tryGetDb();
  if (!db) return <DbSetupNotice />;
  const users = await listUsers();
  return (
    <AccountsManager
      users={users}
      actor={{ id: user.id, role: user.role, permissions: user.permissions }}
    />
  );
}
