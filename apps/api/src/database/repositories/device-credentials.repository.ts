import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import type { DeviceRow, UserRole } from '@hatch-radar/shared';
import { type AppDatabase } from '../internal';

/** 设备凭据管理面数据访问（admin 列表 / 强踢）。设备验签 / 滑动续期仍在 DeviceAuthService。 */
@Injectable()
export class DeviceCredentialsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /** 全部设备凭据（新到旧）。 */
  async listAll(): Promise<DeviceRow[]> {
    const rows = await this.db.device_credentials.findMany({ orderBy: { created_at: 'desc' } });

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

  /**
   * 取设备凭据 + 所属账户角色（强踢前的层级校验用）。
   * @param id 设备凭据 id
   * @returns 凭据 id / 所属用户 id / 用户角色；不存在时返回 null
   */
  async findByIdWithOwnerRole(
    id: string,
  ): Promise<{ id: string; userId: string; ownerRole: UserRole } | null> {
    const cred = await this.db.device_credentials.findUnique({
      where: { id },
      include: { user: { select: { role: true } } },
    });
    if (!cred) {
      return null;
    }

    return { id: cred.id, userId: cred.user_id, ownerRole: cred.user.role as UserRole };
  }

  /**
   * 强踢：吊销设备凭据（下次验签即被拒）。
   * @param id 设备凭据 id
   */
  async revoke(id: string): Promise<void> {
    await this.db.device_credentials.update({ where: { id }, data: { status: 'revoked' } });
  }
}
