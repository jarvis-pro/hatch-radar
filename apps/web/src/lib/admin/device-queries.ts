import 'server-only';
import { getDb } from '@/lib/db';
import { nowSec } from '@/lib/auth/constants';

/** 设备凭据（账户管理设备面板用）。 */
export interface DeviceRow {
  id: string;
  userId: string;
  deviceName: string;
  status: 'active' | 'revoked';
  ttlDays: number;
  expiresAt: number;
  lastSeenAt: number | null;
  createdAt: number;
}

/** 待激活的激活码（pending、未过期）。 */
export interface EnrollmentRow {
  id: string;
  userId: string;
  deviceName: string;
  ttlDays: number;
  expiresAt: number;
  createdAt: number;
}

/** 全部设备凭据（新到旧）。 */
export async function listDevices(): Promise<DeviceRow[]> {
  const rows = await getDb().device_credentials.findMany({ orderBy: { created_at: 'desc' } });
  return rows.map((d) => ({
    id: d.id,
    userId: d.user_id,
    deviceName: d.device_name,
    status: d.status,
    ttlDays: d.ttl_days,
    expiresAt: Number(d.expires_at),
    lastSeenAt: d.last_seen_at != null ? Number(d.last_seen_at) : null,
    createdAt: Number(d.created_at),
  }));
}

/** 全部待激活、未过期的激活码（新到旧）。 */
export async function listPendingEnrollments(): Promise<EnrollmentRow[]> {
  const rows = await getDb().device_enrollments.findMany({
    where: { status: 'pending', expires_at: { gt: BigInt(nowSec()) } },
    orderBy: { created_at: 'desc' },
  });
  return rows.map((e) => ({
    id: e.id,
    userId: e.user_id,
    deviceName: e.device_name,
    ttlDays: e.ttl_days,
    expiresAt: Number(e.expires_at),
    createdAt: Number(e.created_at),
  }));
}
