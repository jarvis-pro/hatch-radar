import { useQuery } from '@tanstack/react-query';
import type { AdminUserRow } from '@hatch-radar/shared';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { RequirePerm } from '@/auth/require-perm';
import { AccountsManager } from '@/components/accounts-manager';
import { LoadError } from '@/components/empty';

function AccountsView() {
  const { user } = useAuth();
  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<AdminUserRow[]>('/admin/users'),
  });

  if (usersQ.error) {
    return (
      <LoadError
        message={usersQ.error instanceof ApiError ? usersQ.error.message : undefined}
        onRetry={() => {
          void usersQ.refetch();
        }}
      />
    );
  }

  if (!user || !usersQ.data) {
    return <Spinner className="size-6 text-muted-foreground" />;
  }

  return <AccountsManager users={usersQ.data} actor={user} />;
}

/** 账户管理（accounts:manage）：建号 / 改权限 / 启停 / 重置 / 删除。 */
export function AccountsPage() {
  return (
    <RequirePerm perm="accounts:manage">
      <AccountsView />
    </RequirePerm>
  );
}
