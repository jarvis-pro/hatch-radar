'use server';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hashPassword } from '@hatch-radar/auth';
import { isPermissionKey, type PermissionKey, type UserRole } from '@hatch-radar/shared';
import { getDb } from '@/lib/db';
import { nowSec } from '@/lib/auth/constants';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/guards';
import { writeAudit } from '@/lib/auth/audit';
import { revokeOtherSessions } from '@/lib/auth/session';
import type { CurrentUser, FormState } from '@/lib/auth/types';

/** 按钮型动作的通用返回（表单型用 FormState）。 */
export interface ActionResult {
  ok: boolean;
  error?: string;
  /** 重置密码后回传的临时密码（仅此一次显示）。 */
  tempPassword?: string;
}

async function actor(): Promise<CurrentUser> {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  return me;
}

function readRole(formData: FormData): UserRole {
  return String(formData.get('role') ?? 'admin') === 'super_admin' ? 'super_admin' : 'admin';
}

/** 生成 12 字符临时密码（base64url）。 */
function tempPassword(): string {
  return randomBytes(9).toString('base64url');
}

/**
 * 把请求的权限收敛为合法 key，且对非超管 actor 限制在其自身拥有的能力内（不能授予自己没有的）。
 */
function sanitizePermissions(me: CurrentUser, requested: string[]): PermissionKey[] {
  const valid = requested.filter(isPermissionKey);
  if (me.role === 'super_admin') return [...new Set(valid)];
  const own = new Set(me.permissions);
  return [...new Set(valid.filter((p) => own.has(p)))];
}

/** 目标是否为「最后一个启用中的超级管理员」（用于阻止停用/删除/降级）。 */
async function isLastActiveSuper(userId: string): Promise<boolean> {
  const db = getDb();
  const t = await db.users.findUnique({ where: { id: userId } });
  if (!t || t.role !== 'super_admin' || t.status !== 'active') return false;
  return (await db.users.count({ where: { role: 'super_admin', status: 'active' } })) <= 1;
}

/** 新建管理员。 */
export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await actor();
  if (!can(me, 'accounts:manage')) return { error: '无权管理账户' };
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const role = readRole(formData);
  const password = String(formData.get('password') ?? '');
  const requireChange = formData.get('requireChange') != null;
  if (!email || !name) return { error: '邮箱与姓名必填' };
  if (password.length < 8) return { error: '初始密码至少 8 位' };
  if (role === 'super_admin' && me.role !== 'super_admin') {
    return { error: '只有超级管理员能创建超级管理员' };
  }
  const perms =
    role === 'admin' ? sanitizePermissions(me, formData.getAll('perm').map(String)) : [];
  try {
    const db = getDb();
    if (await db.users.findUnique({ where: { email } })) return { error: '该邮箱已存在' };
    const now = BigInt(nowSec());
    const user = await db.users.create({
      data: {
        email,
        name,
        password_hash: await hashPassword(password),
        role,
        status: 'active',
        must_change_password: requireChange,
        created_by: me.id,
        created_at: now,
        updated_at: now,
        permissions: perms.length
          ? { create: perms.map((p) => ({ permission: p, granted_by: me.id, granted_at: now })) }
          : undefined,
      },
    });
    await writeAudit({
      actorId: me.id,
      action: 'account.create',
      targetType: 'user',
      targetId: user.id,
      metadata: { email, role, permissions: perms },
    });
  } catch {
    return { error: '创建失败：服务暂时不可用' };
  }
  revalidatePath('/admin/accounts');
  return { ok: true };
}

/** 编辑管理员资料 / 角色 / 权限。 */
export async function editUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await actor();
  if (!can(me, 'accounts:manage')) return { error: '无权管理账户' };
  const userId = String(formData.get('userId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const role = readRole(formData);
  if (!userId || !name) return { error: '参数不完整' };
  try {
    const db = getDb();
    const target = await db.users.findUnique({ where: { id: userId } });
    if (!target) return { error: '账户不存在' };
    if (target.role === 'super_admin' && me.role !== 'super_admin') {
      return { error: '只有超级管理员能管理超级管理员' };
    }
    if (role === 'super_admin' && me.role !== 'super_admin') {
      return { error: '只有超级管理员能授予超管角色' };
    }
    if (
      target.role === 'super_admin' &&
      role !== 'super_admin' &&
      (await isLastActiveSuper(userId))
    ) {
      return { error: '不能降级最后一个超级管理员' };
    }
    const now = BigInt(nowSec());
    const perms =
      role === 'admin' ? sanitizePermissions(me, formData.getAll('perm').map(String)) : [];
    await db.$transaction([
      db.users.update({ where: { id: userId }, data: { name, role, updated_at: now } }),
      db.user_permissions.deleteMany({ where: { user_id: userId } }),
      ...(perms.length
        ? [
            db.user_permissions.createMany({
              data: perms.map((p) => ({
                user_id: userId,
                permission: p,
                granted_by: me.id,
                granted_at: now,
              })),
            }),
          ]
        : []),
    ]);
    await writeAudit({
      actorId: me.id,
      action: 'account.update',
      targetType: 'user',
      targetId: userId,
      metadata: { name, role, permissions: perms },
    });
  } catch {
    return { error: '保存失败：服务暂时不可用' };
  }
  revalidatePath('/admin/accounts');
  return { ok: true };
}

/** 重置某账户密码为随机临时密码，并强制其首登改密、踢下线。返回临时密码。 */
export async function resetPasswordAction(userId: string): Promise<ActionResult> {
  const me = await actor();
  if (!can(me, 'accounts:manage')) return { ok: false, error: '无权管理账户' };
  try {
    const db = getDb();
    const target = await db.users.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: '账户不存在' };
    if (target.role === 'super_admin' && me.role !== 'super_admin') {
      return { ok: false, error: '只有超级管理员能重置超级管理员密码' };
    }
    const pw = tempPassword();
    await db.users.update({
      where: { id: userId },
      data: {
        password_hash: await hashPassword(pw),
        must_change_password: true,
        updated_at: BigInt(nowSec()),
      },
    });
    await db.sessions.deleteMany({ where: { user_id: userId } });
    await writeAudit({
      actorId: me.id,
      action: 'account.password.reset',
      targetType: 'user',
      targetId: userId,
    });
    revalidatePath('/admin/accounts');
    return { ok: true, tempPassword: pw };
  } catch {
    return { ok: false, error: '重置失败：服务暂时不可用' };
  }
}

/** 启用 / 停用账户（停用即踢下线）。 */
export async function setUserStatusAction(
  userId: string,
  status: 'active' | 'disabled',
): Promise<ActionResult> {
  const me = await actor();
  if (!can(me, 'accounts:manage')) return { ok: false, error: '无权管理账户' };
  if (userId === me.id) return { ok: false, error: '不能停用 / 启用自己' };
  try {
    const db = getDb();
    const target = await db.users.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: '账户不存在' };
    if (target.role === 'super_admin' && me.role !== 'super_admin') {
      return { ok: false, error: '只有超级管理员能管理超级管理员' };
    }
    if (status === 'disabled' && (await isLastActiveSuper(userId))) {
      return { ok: false, error: '不能停用最后一个超级管理员' };
    }
    await db.users.update({
      where: { id: userId },
      data: { status, updated_at: BigInt(nowSec()) },
    });
    if (status === 'disabled') await db.sessions.deleteMany({ where: { user_id: userId } });
    await writeAudit({
      actorId: me.id,
      action: status === 'disabled' ? 'account.disable' : 'account.enable',
      targetType: 'user',
      targetId: userId,
    });
    revalidatePath('/admin/accounts');
    return { ok: true };
  } catch {
    return { ok: false, error: '操作失败：服务暂时不可用' };
  }
}

/** 删除账户（级联清理其权限 / 会话 / 设备）。 */
export async function deleteUserAction(userId: string): Promise<ActionResult> {
  const me = await actor();
  if (!can(me, 'accounts:manage')) return { ok: false, error: '无权管理账户' };
  if (userId === me.id) return { ok: false, error: '不能删除自己' };
  try {
    const db = getDb();
    const target = await db.users.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: '账户不存在' };
    if (target.role === 'super_admin' && me.role !== 'super_admin') {
      return { ok: false, error: '只有超级管理员能删除超级管理员' };
    }
    if (await isLastActiveSuper(userId)) {
      return { ok: false, error: '不能删除最后一个超级管理员' };
    }
    await db.users.delete({ where: { id: userId } });
    await writeAudit({
      actorId: me.id,
      action: 'account.delete',
      targetType: 'user',
      targetId: userId,
      metadata: { email: target.email },
    });
    revalidatePath('/admin/accounts');
    return { ok: true };
  } catch {
    return { ok: false, error: '删除失败：服务暂时不可用' };
  }
}

/** 个人中心：修改本人姓名。 */
export async function updateOwnNameAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await actor();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: '姓名不能为空' };
  try {
    await getDb().users.update({
      where: { id: me.id },
      data: { name, updated_at: BigInt(nowSec()) },
    });
  } catch {
    return { error: '保存失败：服务暂时不可用' };
  }
  revalidatePath('/account');
  return { ok: true };
}

/** 个人中心：登出除当前外的其它会话。 */
export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  const me = await actor();
  try {
    await revokeOtherSessions(me.id, me.sessionId);
    revalidatePath('/account');
    return { ok: true };
  } catch {
    return { ok: false, error: '操作失败：服务暂时不可用' };
  }
}

/** 个人中心：登出指定会话（仅限本人会话）。 */
export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  const me = await actor();
  try {
    await getDb().sessions.deleteMany({ where: { id: sessionId, user_id: me.id } });
    revalidatePath('/account');
    return { ok: true };
  } catch {
    return { ok: false, error: '操作失败：服务暂时不可用' };
  }
}
