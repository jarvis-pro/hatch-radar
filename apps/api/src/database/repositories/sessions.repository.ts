import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import { type AppDatabase } from '@/database/internal';

/** 新建会话的入参（TTL 策略由 AccountService 计算后传入）。 */
export interface CreateSessionInput {
  /** 所属用户 id */
  userId: string;
  /** 会话 token 的哈希（明文 token 仅返回客户端，库存哈希） */
  tokenHash: string;
  /** 过期时刻（epoch 秒），由 AccountService 按 idle / absolute 策略算出 */
  expiresAt: number;
  /** 最近活跃时刻（epoch 秒） */
  lastSeenAt: number;
  /** 创建时刻（epoch 秒），绝对过期窗的锚点 */
  createdAt: number;
  /** 客户端 User-Agent；不可得时为空 */
  userAgent?: string | null;
  /** 客户端 IP；不可得时为空 */
  ip?: string | null;
}

/** 会话表数据访问（不含 TTL 策略，仅存取）。 */
@Injectable()
export class SessionsRepository {
  constructor(
    // 事务感知 Prisma 客户端（经 @Inject(PRISMA)，按 ALS 自动路由事务/根客户端）：读写会话（sessions）表
    @Inject(PRISMA) private readonly db: AppDatabase,
  ) {}

  /**
   * 新建一条会话（token 已在 service 哈希）。
   * @param input 会话字段（见 {@link CreateSessionInput}）
   */
  async create(input: CreateSessionInput): Promise<void> {
    await this.db.sessions.create({
      data: {
        user_id: input.userId,
        token_hash: input.tokenHash,
        expires_at: BigInt(input.expiresAt),
        last_seen_at: BigInt(input.lastSeenAt),
        user_agent: input.userAgent ?? null,
        ip: input.ip ?? null,
        created_at: BigInt(input.createdAt),
      },
    });
  }

  /**
   * 按 token 哈希取会话原始行（含 bigint 时间戳，供滑动续期判定）。
   * @param tokenHash 会话 token 的哈希
   */
  findByTokenHash(tokenHash: string) {
    return this.db.sessions.findUnique({ where: { token_hash: tokenHash } });
  }

  /**
   * 删除指定会话（清理坏会话）。
   * @param id 会话 id
   */
  async deleteById(id: string): Promise<void> {
    await this.db.sessions.delete({ where: { id } }).catch(() => undefined);
  }

  /**
   * 按 token 哈希删除会话（登出）。
   * @param tokenHash 会话 token 的哈希
   */
  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.sessions.deleteMany({ where: { token_hash: tokenHash } });
  }

  /**
   * 删除某用户全部会话（停用 / 重置密码 → 强制下线）。
   * @param userId 用户 id
   */
  async deleteByUser(userId: string): Promise<void> {
    await this.db.sessions.deleteMany({ where: { user_id: userId } });
  }

  /**
   * 删除某用户除保留会话外的全部会话（改密 / 「登出其他会话」）。
   * @param userId 用户 id
   * @param keepSessionId 保留的会话 id（当前会话）
   */
  async deleteOthers(userId: string, keepSessionId: string): Promise<void> {
    await this.db.sessions.deleteMany({ where: { user_id: userId, id: { not: keepSessionId } } });
  }

  /**
   * 登出指定会话（仅限本人会话）。
   * @param sessionId 待登出的会话 id
   * @param userId 用户 id（限定只能删本人会话）
   */
  async deleteOwn(sessionId: string, userId: string): Promise<void> {
    await this.db.sessions.deleteMany({ where: { id: sessionId, user_id: userId } });
  }

  /**
   * 滑动续期：更新 last_seen_at 与 expires_at（失败吞掉，不阻断鉴权）。
   * @param id 会话 id
   * @param lastSeenAt 最近活跃时刻 Unix 时间戳（秒）
   * @param expiresAt 新的过期时刻 Unix 时间戳（秒）
   */
  async touch(id: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    await this.db.sessions
      .update({
        where: { id },
        data: { last_seen_at: BigInt(lastSeenAt), expires_at: BigInt(expiresAt) },
      })
      .catch(() => undefined);
  }

  /**
   * 某用户当前未过期的会话列表（个人中心展示，最近活跃在前）。
   * @param userId 用户 id
   * @param now 当前 Unix 时间戳（秒，判定未过期）
   */
  async listActiveByUser(
    userId: string,
    now: number,
  ): Promise<
    {
      id: string;
      userAgent: string | null;
      ip: string | null;
      lastSeenAt: number;
      createdAt: number;
    }[]
  > {
    const rows = await this.db.sessions.findMany({
      where: { user_id: userId, expires_at: { gt: BigInt(now) } },
      orderBy: { last_seen_at: 'desc' },
    });

    return rows.map((s) => ({
      id: s.id,
      userAgent: s.user_agent,
      ip: s.ip,
      lastSeenAt: Number(s.last_seen_at),
      createdAt: Number(s.created_at),
    }));
  }
}
