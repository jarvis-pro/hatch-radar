import type { Metadata } from 'next';
import { AccountsManager } from '@/components/accounts-manager';
import { DbSetupNotice } from '@/components/empty';
import { Forbidden } from '@/components/forbidden';
import { requirePermission } from '@/lib/auth/guards';
import { listUsers } from '@/lib/admin/queries';
import { listDevices, listPendingEnrollments } from '@/lib/admin/device-queries';
import { tryGetDb } from '@/lib/db';

export const metadata: Metadata = { title: '账户管理' };
export const dynamic = 'force-dynamic';

/** 账户管理（accounts:manage）：建号 / 改权限 / 启停 / 重置 / 删除。 */
export default async function AccountsPage() {
  const { user, allowed } = await requirePermission('accounts:manage');
  if (!allowed) return <Forbidden />;
  const db = await tryGetDb();
  if (!db) return <DbSetupNotice />;
  const [users, devices, enrollments] = await Promise.all([
    listUsers(),
    listDevices(),
    listPendingEnrollments(),
  ]);
  return (
    <AccountsManager
      users={users}
      actor={{ id: user.id, role: user.role, permissions: user.permissions }}
      devicesByUser={groupByUser(devices)}
      enrollmentsByUser={groupByUser(enrollments)}
    />
  );
}

/** 按 userId 分组（设备 / 待激活面板用）。 */
function groupByUser<T extends { userId: string }>(items: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of items) (out[it.userId] ??= []).push(it);
  return out;
}
