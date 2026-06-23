import { useQuery } from '@tanstack/react-query';
import type { AdminUserRow, DeviceRow, EnrollmentRow } from '@hatch-radar/shared';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { RequirePerm } from '@/auth/require-perm';
import { AccountsManager } from '@/components/accounts-manager';
import { LoadError } from '@/components/empty';

/** 按 userId 分组（设备 / 待激活面板用）。 */
function groupByUser<T extends { userId: string }>(items: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of items) {
    (out[it.userId] ??= []).push(it);
  }
  return out;
}

function AccountsView() {
  const { user } = useAuth();
  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<AdminUserRow[]>('/admin/users'),
  });
  const devicesQ = useQuery({
    queryKey: ['admin', 'devices'],
    queryFn: () => api.get<DeviceRow[]>('/admin/devices'),
  });
  const enrollQ = useQuery({
    queryKey: ['admin', 'enrollments'],
    queryFn: () => api.get<EnrollmentRow[]>('/admin/enrollments'),
  });

  const firstError = usersQ.error ?? devicesQ.error ?? enrollQ.error;
  if (firstError) {
    return (
      <LoadError
        message={firstError instanceof ApiError ? firstError.message : undefined}
        onRetry={() => {
          void usersQ.refetch();
          void devicesQ.refetch();
          void enrollQ.refetch();
        }}
      />
    );
  }
  if (!user || !usersQ.data || !devicesQ.data || !enrollQ.data) {
    return <Spinner className="size-6 text-muted-foreground" />;
  }
  return (
    <AccountsManager
      users={usersQ.data}
      actor={user}
      devicesByUser={groupByUser(devicesQ.data)}
      enrollmentsByUser={groupByUser(enrollQ.data)}
    />
  );
}

/** 账户管理（accounts:manage）：建号 / 改权限 / 启停 / 重置 / 删除 / 设备。 */
export function AccountsPage() {
  return (
    <RequirePerm perm="accounts:manage">
      <AccountsView />
    </RequirePerm>
  );
}
