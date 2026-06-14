import 'server-only';
import { isPermissionKey, type PermissionKey, type UserRole } from '@hatch-radar/shared';
import { getDb } from '@/lib/db';

/** 账户管理列表的一行（含已授予权限与设备数）。 */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  permissions: PermissionKey[];
  deviceCount: number;
  lastLoginAt: number | null;
  createdAt: number;
}

/** 全部账户（超管在前，再按创建时间）。 */
export async function listUsers(): Promise<AdminUserRow[]> {
  const rows = await getDb().users.findMany({
    include: { permissions: true, _count: { select: { devices: true } } },
    orderBy: [{ role: 'asc' }, { created_at: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as UserRole,
    status: r.status,
    mustChangePassword: r.must_change_password,
    permissions: r.permissions.map((p) => p.permission).filter(isPermissionKey),
    deviceCount: r._count.devices,
    lastLoginAt: r.last_login_at != null ? Number(r.last_login_at) : null,
    createdAt: Number(r.created_at),
  }));
}

/** 审计列表的一行（actor_id 已解析为邮箱）。 */
export interface AuditRow {
  id: number;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  createdAt: number;
}

const AUDIT_PAGE = 50;

/** 审计日志分页（按 action 关键词可选过滤，时间倒序）。 */
export async function listAuditLogs(opts: {
  q?: string;
  page: number;
}): Promise<{ items: AuditRow[]; total: number; page: number; pageCount: number }> {
  const db = getDb();
  const where = opts.q ? { action: { contains: opts.q, mode: 'insensitive' as const } } : {};
  const total = await db.audit_logs.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE));
  const page = Math.min(Math.max(1, opts.page), pageCount);
  const rows = await db.audit_logs.findMany({
    where,
    orderBy: { id: 'desc' },
    skip: (page - 1) * AUDIT_PAGE,
    take: AUDIT_PAGE,
  });
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const actors = actorIds.length
    ? await db.users.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true },
      })
    : [];
  const emailById = new Map(actors.map((a) => [a.id, a.email]));
  return {
    items: rows.map((r) => ({
      id: r.id,
      actorEmail: r.actor_id ? (emailById.get(r.actor_id) ?? '(已删除账户)') : null,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      ip: r.ip,
      createdAt: Number(r.created_at),
    })),
    total,
    page,
    pageCount,
  };
}
