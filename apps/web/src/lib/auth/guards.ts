import 'server-only';
import { redirect } from 'next/navigation';
import { hasPermission, type PermissionKey } from '@hatch-radar/shared';
import { getCurrentUser } from './current-user';
import type { CurrentUser } from './types';

/**
 * 要求已登录。未登录 → /login；强制改密 → /account/password（除非显式放行）。
 * @param opts.allowPasswordChange 改密页自身传 true，避免重定向死循环
 */
export async function requireUser(opts?: { allowPasswordChange?: boolean }): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword && !opts?.allowPasswordChange) redirect('/account/password');
  return user;
}

/** 当前用户是否具备某能力（super_admin 隐式全通；停用即否）。 */
export function can(user: CurrentUser, key: PermissionKey): boolean {
  return hasPermission(user.role, user.permissions, key, user.status === 'active');
}

/**
 * 要求登录 + 具备能力。返回 { user, allowed }——页面据 allowed 渲染内容或 Forbidden。
 * （不直接抛 403：避免依赖 Next 实验性的 forbidden()，由页面决定如何呈现。）
 */
export async function requirePermission(
  key: PermissionKey,
): Promise<{ user: CurrentUser; allowed: boolean }> {
  const user = await requireUser();
  return { user, allowed: can(user, key) };
}
