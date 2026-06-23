import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import type { EnrollmentRow } from '@hatch-radar/shared';
import { type AppDatabase } from '../internal';

/** 设备激活码管理面数据访问（admin 赋予设备 / 取消）。激活消费仍在 DeviceAuthService。 */
@Injectable()
export class DeviceEnrollmentsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 全部待激活、未过期的激活码（新到旧）。
   * @param now 当前 Unix 时间戳（秒，过滤未过期）
   */
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

  /**
   * 新建一条 pending 激活码（code 已在 service 哈希）。
   * @param input.userId 设备所属账户 id
   * @param input.deviceName 设备名
   * @param input.codeHash 激活码的 sha256（明文仅返回客户端一次）
   * @param input.ttlDays 离线宽限窗天数
   * @param input.expiresAt 激活码过期时刻（epoch 秒）
   * @param input.issuedBy 签发操作者 id；系统为 null
   * @param input.now 创建时刻 Unix 时间戳（秒）
   * @returns 新建 enrollment id
   */
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

  /**
   * 取消一个仍 pending 的激活码。
   * @param id 激活码（enrollment）id
   */
  async cancel(id: string): Promise<void> {
    await this.db.device_enrollments.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'revoked' },
    });
  }
}
