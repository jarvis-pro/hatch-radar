import { Inject, Injectable } from '@nestjs/common';
import { sha256Hex, verifyDeviceSignature } from '@hatch-radar/auth';
import { hasPermission, type PermissionKey, type UserRole } from '@hatch-radar/shared';
import { Prisma, type AppDatabase } from '@hatch-radar/db';
import { PRISMA } from '@/common/tokens';
import type { DeviceUserContext } from './device-permission.decorator';

/** 设备签名请求的时间窗（秒）：|now - ts| 超过即拒，挡重放。 */
const TS_WINDOW = 60;
const DAY = 86_400;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const v = headers[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** 设备认证：激活码换凭据、签名请求验签、设备操作审计。 */
@Injectable()
export class DeviceAuthService {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 用激活码 + 设备公钥换取一条 device_credentials（绑定到激活码所属账户）。
   * 码无效 / 已用 / 过期一律返回 null（不泄露原因）。
   * @returns 凭据 id（设备后续用作 x-device-id）
   */
  async enroll(input: {
    code: string;
    deviceName?: string;
    publicKey: string;
  }): Promise<{ credentialId: string } | null> {
    const code = input.code.trim();
    const publicKey = input.publicKey.trim();
    if (!code || !publicKey) return null;
    const now = nowSec();
    const enrollment = await this.db.device_enrollments.findUnique({
      where: { code_hash: sha256Hex(code) },
    });
    if (!enrollment || enrollment.status !== 'pending' || Number(enrollment.expires_at) <= now) {
      return null;
    }
    const cred = await this.db.$transaction(async (tx) => {
      const created = await tx.device_credentials.create({
        data: {
          user_id: enrollment.user_id,
          device_name: input.deviceName?.trim() || enrollment.device_name,
          public_key: publicKey,
          ttl_days: enrollment.ttl_days,
          status: 'active',
          expires_at: BigInt(now + enrollment.ttl_days * DAY),
          issued_by: enrollment.issued_by,
          created_at: BigInt(now),
        },
      });
      await tx.device_enrollments.update({
        where: { id: enrollment.id },
        data: { status: 'consumed', consumed_at: BigInt(now) },
      });
      return created;
    });
    await this.recordAudit({
      actorId: enrollment.issued_by,
      action: 'device.enroll',
      targetType: 'device',
      targetId: cred.id,
      metadata: { user_id: enrollment.user_id },
    });
    return { credentialId: cred.id };
  }

  /**
   * 校验设备签名请求：头里取 x-device-id / x-device-ts / x-device-sig，
   * 验时间窗 → 查凭据（active 未过期）→ 用存的公钥验 Ed25519 签名 → 查账户启用 → 校验所需能力。
   * 成功滑动续期并返回设备用户上下文，否则返回 null。
   */
  async verifyRequest(
    req: {
      headers: Record<string, string | string[] | undefined>;
      method?: string;
      originalUrl?: string;
      url?: string;
    },
    requiredPerm?: PermissionKey,
  ): Promise<DeviceUserContext | null> {
    const credentialId = header(req.headers, 'x-device-id');
    const ts = Number(header(req.headers, 'x-device-ts'));
    const sig = header(req.headers, 'x-device-sig');
    if (!credentialId || !sig || !Number.isInteger(ts)) return null;
    const now = nowSec();
    if (Math.abs(now - ts) > TS_WINDOW) return null;

    const cred = await this.db.device_credentials.findUnique({
      where: { id: credentialId },
      include: { user: { include: { permissions: true } } },
    });
    if (!cred || cred.status !== 'active' || Number(cred.expires_at) <= now) return null;

    const method = (req.method ?? 'GET').toUpperCase();
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    const canonical = `${credentialId}.${ts}.${method}.${path}`;
    if (!verifyDeviceSignature(cred.public_key, canonical, sig)) return null;

    const user = cred.user;
    if (!user || user.status !== 'active') return null;
    if (requiredPerm) {
      const perms = user.permissions.map((p) => p.permission);
      if (!hasPermission(user.role as UserRole, perms, requiredPerm, true)) return null;
    }

    await this.db.device_credentials
      .update({
        where: { id: credentialId },
        data: { last_seen_at: BigInt(now), expires_at: BigInt(now + cred.ttl_days * DAY) },
      })
      .catch(() => undefined);

    return { id: user.id, role: user.role as UserRole, email: user.email, credentialId };
  }

  /** 写一条审计（server 直写 audit_logs；失败不阻断主流程）。 */
  async recordAudit(entry: {
    actorId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.audit_logs.create({
        data: {
          actor_id: entry.actorId ?? null,
          action: entry.action,
          target_type: entry.targetType ?? null,
          target_id: entry.targetId ?? null,
          ...(entry.metadata !== undefined
            ? { metadata: entry.metadata as Prisma.InputJsonValue }
            : {}),
          created_at: BigInt(nowSec()),
        },
      });
    } catch {
      // 审计失败不影响主流程
    }
  }
}
