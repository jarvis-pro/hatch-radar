import { type AppDatabase } from '../internal';

/** 登录限流计数表数据访问（滑动窗 / 锁定策略由 AccountService 决定，本类只存取）。 */
export class LoginAttemptsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** 取某邮箱的失败计数行（含 bigint 时间戳）。 */
  findByEmail(email: string) {
    return this.db.login_attempts.findUnique({ where: { email } });
  }

  /** 写入 / 更新失败计数与锁定到期。 */
  async record(
    email: string,
    failedCount: number,
    lockedUntil: number | null,
    now: number,
  ): Promise<void> {
    const locked = lockedUntil != null ? BigInt(lockedUntil) : null;
    await this.db.login_attempts.upsert({
      where: { email },
      create: {
        email,
        failed_count: failedCount,
        locked_until: locked,
        last_attempt_at: BigInt(now),
        updated_at: BigInt(now),
      },
      update: {
        failed_count: failedCount,
        locked_until: locked,
        last_attempt_at: BigInt(now),
        updated_at: BigInt(now),
      },
    });
  }

  /** 登录成功后清除该邮箱的失败计数。 */
  async clear(email: string): Promise<void> {
    await this.db.login_attempts.deleteMany({ where: { email } });
  }
}
