import { type AppDatabase } from '../internal';

/** 新建会话的入参（TTL 策略由 AccountService 计算后传入）。 */
export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  lastSeenAt: number;
  createdAt: number;
  userAgent?: string | null;
  ip?: string | null;
}

/** 会话表数据访问（不含 TTL 策略，仅存取）。 */
export class SessionsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** 新建一条会话（token 已在 service 哈希）。 */
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

  /** 按 token 哈希取会话原始行（含 bigint 时间戳，供滑动续期判定）。 */
  findByTokenHash(tokenHash: string) {
    return this.db.sessions.findUnique({ where: { token_hash: tokenHash } });
  }

  /** 删除指定会话（清理坏会话）。 */
  async deleteById(id: string): Promise<void> {
    await this.db.sessions.delete({ where: { id } }).catch(() => undefined);
  }

  /** 按 token 哈希删除会话（登出）。 */
  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.sessions.deleteMany({ where: { token_hash: tokenHash } });
  }

  /** 删除某用户全部会话（停用 / 重置密码 → 强制下线）。 */
  async deleteByUser(userId: string): Promise<void> {
    await this.db.sessions.deleteMany({ where: { user_id: userId } });
  }

  /** 删除某用户除保留会话外的全部会话（改密 / 「登出其他会话」）。 */
  async deleteOthers(userId: string, keepSessionId: string): Promise<void> {
    await this.db.sessions.deleteMany({ where: { user_id: userId, id: { not: keepSessionId } } });
  }

  /** 登出指定会话（仅限本人会话）。 */
  async deleteOwn(sessionId: string, userId: string): Promise<void> {
    await this.db.sessions.deleteMany({ where: { id: sessionId, user_id: userId } });
  }

  /** 滑动续期：更新 last_seen_at 与 expires_at（失败吞掉，不阻断鉴权）。 */
  async touch(id: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    await this.db.sessions
      .update({
        where: { id },
        data: { last_seen_at: BigInt(lastSeenAt), expires_at: BigInt(expiresAt) },
      })
      .catch(() => undefined);
  }

  /** 某用户当前未过期的会话列表（个人中心展示，最近活跃在前）。 */
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
