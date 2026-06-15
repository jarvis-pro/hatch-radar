import type { EnrollmentRow } from '@hatch-radar/shared';
import { type AppDatabase } from '../internal';

/** 设备激活码管理面数据访问（admin 赋予设备 / 取消）。激活消费仍在 DeviceAuthService。 */
export class DeviceEnrollmentsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** 全部待激活、未过期的激活码（新到旧）。 */
  async listPending(now: number): Promise<EnrollmentRow[]> {
    const rows = await this.db.device_enrollments.findMany({
      where: { status: 'pending', expires_at: { gt: BigInt(now) } },
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

  /** 新建一条 pending 激活码（code 已在 service 哈希）。返回 enrollment id。 */
  async create(input: {
    userId: string;
    deviceName: string;
    codeHash: string;
    ttlDays: number;
    expiresAt: number;
    issuedBy: string | null;
    now: number;
  }): Promise<string> {
    const row = await this.db.device_enrollments.create({
      data: {
        user_id: input.userId,
        device_name: input.deviceName,
        code_hash: input.codeHash,
        ttl_days: input.ttlDays,
        status: 'pending',
        expires_at: BigInt(input.expiresAt),
        issued_by: input.issuedBy,
        created_at: BigInt(input.now),
      },
    });
    return row.id;
  }

  /** 取消一个仍 pending 的激活码。 */
  async cancel(id: string): Promise<void> {
    await this.db.device_enrollments.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'revoked' },
    });
  }
}
