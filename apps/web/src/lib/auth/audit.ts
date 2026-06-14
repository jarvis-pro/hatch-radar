import 'server-only';
import { Prisma } from '@hatch-radar/db';
import { getDb } from '@/lib/db';
import { nowSec } from './constants';

/** 一条审计记录的输入。 */
export interface AuditEntry {
  /** 操作者 users.id；系统动作或匿名（登录失败）为空。 */
  actorId?: string | null;
  /** 操作类型，如 auth.login / account.create / permission.update / device.revoke。 */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** 写一条审计；失败只吞掉、绝不阻断主流程。 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await getDb().audit_logs.create({
      data: {
        actor_id: entry.actorId ?? null,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        ...(entry.metadata !== undefined
          ? { metadata: entry.metadata as Prisma.InputJsonValue }
          : {}),
        ip: entry.ip ?? null,
        created_at: BigInt(nowSec()),
      },
    });
  } catch {
    // 审计失败不影响主流程
  }
}
