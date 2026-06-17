import { Check, Minus } from 'lucide-react';
import {
  hasPermission,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  type CurrentUser,
} from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { useAuth } from '@/auth/auth-context';
import { PageHeader } from '@/components/page-header';

/** 个人中心 · 我的权限：只读展示当前账户拥有的能力。 */
export function PermissionsPage() {
  const { user } = useAuth();
  if (!user) return null; // 受 ProtectedLayout 守卫，理论不达此
  return (
    <div>
      <PageHeader title="我的权限" description="你在本控制台拥有的能力" />
      <MyPermissions user={user} />
    </div>
  );
}

function MyPermissions({ user }: { user: CurrentUser }) {
  if (user.role === 'super_admin') {
    return (
      <p className="text-sm text-muted-foreground">
        你是<span className="font-medium text-foreground">超级管理员</span>，隐式拥有全部能力。
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group} className="grid gap-1">
          <div className="text-xs font-medium text-muted-foreground">{group}</div>
          {PERMISSION_CATALOG.filter((c) => c.group === group).map((c) => {
            const granted = hasPermission(user.role, user.permissions, c.key);
            return (
              <div key={c.key} className="flex items-center gap-2 text-sm">
                {granted ? (
                  <Check className="size-4 text-primary" />
                ) : (
                  <Minus className="size-4 text-muted-foreground/50" />
                )}
                <span className={granted ? '' : 'text-muted-foreground/60'}>{c.label}</span>
                {c.sensitive ? (
                  <Badge variant="outline" className="text-[10px]">
                    敏感
                  </Badge>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
