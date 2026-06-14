'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { generateEnrollmentCode, sha256Hex } from '@hatch-radar/auth';
import { getDb } from '@/lib/db';
import { nowSec } from '@/lib/auth/constants';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/guards';
import { writeAudit } from '@/lib/auth/audit';
import type { CurrentUser } from '@/lib/auth/types';
import type { ActionResult } from './actions';

/** 激活码有效期（秒）：短，15 分钟。 */
const ENROLL_TTL_SEC = 15 * 60;
/** 允许的离线宽限窗（天）。 */
const ALLOWED_TTL_DAYS = [7, 30, 60];

async function actor(): Promise<CurrentUser> {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  return me;
}

/** 为某用户「赋予设备」：生成一次性激活码（仅此次返回明文，库存 sha256）。 */
export async function createEnrollmentAction(
  userId: string,
  deviceName: string,
  ttlDays: number,
): Promise<ActionResult & { code?: string }> {
  const me = await actor();
  if (!can(me, 'accounts:manage')) return { ok: false, error: '无权管理账户' };
  const name = deviceName.trim();
  if (!name) return { ok: false, error: '请填写设备名' };
  const ttl = ALLOWED_TTL_DAYS.includes(ttlDays) ? ttlDays : 30;
  try {
    const db = getDb();
    const target = await db.users.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: '账户不存在' };
    if (target.role === 'super_admin' && me.role !== 'super_admin') {
      return { ok: false, error: '只有超级管理员能为超级管理员赋予设备' };
    }
    const code = generateEnrollmentCode();
    const now = BigInt(nowSec());
    const row = await db.device_enrollments.create({
      data: {
        user_id: userId,
        device_name: name,
        code_hash: sha256Hex(code),
        ttl_days: ttl,
        status: 'pending',
        expires_at: BigInt(nowSec() + ENROLL_TTL_SEC),
        issued_by: me.id,
        created_at: now,
      },
    });
    await writeAudit({
      actorId: me.id,
      action: 'device.enroll.provision',
      targetType: 'user',
      targetId: userId,
      metadata: { enrollmentId: row.id, deviceName: name, ttlDays: ttl },
    });
    revalidatePath('/admin/accounts');
    return { ok: true, code };
  } catch {
    return { ok: false, error: '生成失败：服务暂时不可用' };
  }
}

/** 强踢：吊销某设备凭据（下次验签即被拒）。 */
export async function revokeDeviceAction(credentialId: string): Promise<ActionResult> {
  const me = await actor();
  if (!can(me, 'accounts:manage')) return { ok: false, error: '无权管理账户' };
  try {
    const db = getDb();
    const cred = await db.device_credentials.findUnique({
      where: { id: credentialId },
      include: { user: true },
    });
    if (!cred) return { ok: false, error: '设备不存在' };
    if (cred.user.role === 'super_admin' && me.role !== 'super_admin') {
      return { ok: false, error: '只有超级管理员能管理超级管理员的设备' };
    }
    await db.device_credentials.update({
      where: { id: credentialId },
      data: { status: 'revoked' },
    });
    await writeAudit({
      actorId: me.id,
      action: 'device.revoke',
      targetType: 'device',
      targetId: credentialId,
      metadata: { user_id: cred.user_id },
    });
    revalidatePath('/admin/accounts');
    return { ok: true };
  } catch {
    return { ok: false, error: '操作失败：服务暂时不可用' };
  }
}

/** 取消一个待激活的激活码。 */
export async function cancelEnrollmentAction(enrollmentId: string): Promise<ActionResult> {
  const me = await actor();
  if (!can(me, 'accounts:manage')) return { ok: false, error: '无权管理账户' };
  try {
    await getDb().device_enrollments.updateMany({
      where: { id: enrollmentId, status: 'pending' },
      data: { status: 'revoked' },
    });
    await writeAudit({
      actorId: me.id,
      action: 'device.enroll.cancel',
      targetType: 'enrollment',
      targetId: enrollmentId,
    });
    revalidatePath('/admin/accounts');
    return { ok: true };
  } catch {
    return { ok: false, error: '操作失败：服务暂时不可用' };
  }
}
