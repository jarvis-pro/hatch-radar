import type { ReactNode } from 'react';
import type { PermissionKey } from '@hatch-radar/shared';
import { Forbidden } from '@/components/forbidden';
import { can, useAuth } from './auth-context';

/** 能力闸（仅体验层显隐；server 端点同样会 403）：有权渲染 children，否则渲 Forbidden。 */
export function RequirePerm({ perm, children }: { perm: PermissionKey; children: ReactNode }) {
  const { user } = useAuth();
  return can(user, perm) ? <>{children}</> : <Forbidden />;
}
