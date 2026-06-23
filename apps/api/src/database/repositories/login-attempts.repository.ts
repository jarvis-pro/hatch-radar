import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import { type AppDatabase } from '../internal';

/**
 * 登录限流计数表数据访问（滑动窗 / 锁定策略由 AccountService 决定，本类只存取）。
 * 按「限流桶键」寻址：键形如 `email:<归一邮箱>` 或 `ip:<客户端 IP>`，email / IP 两维共用本表与同一套机制。
 */
@Injectable()
export class LoginAttemptsRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 取某限流桶的失败计数行（含 bigint 时间戳）。
   * @param key 限流桶键（`email:` / `ip:` 前缀）
   * @returns 计数行；从未失败过返回 null
   */
  findByKey(key: string) {
    return this.db.login_attempts.findUnique({ where: { key } });
  }

  /**
   * 原子记一次登录失败：滑动窗内累加、窗外重置为 1，并按阈值派生锁定到期。
   *
   * - 用单条 INSERT ... ON CONFLICT 在数据库内完成「读-改-写」，杜绝并发失败各读旧值导致的丢计数
   * - 策略参数（窗口 / 阈值 / 锁时长）由调用方传入，本类只负责原子执行
   * - Prisma ORM 无法表达「按上次时间条件自增 + 据新值派生锁定」的单语句 upsert，故下沉为 $executeRaw
   * @param key 限流桶键（`email:` / `ip:` 前缀）
   * @param opts.now 当前 Unix 时间戳（秒）
   * @param opts.windowSec 滑动窗时长（秒）：上次尝试在此窗内则累加，否则重置为 1
   * @param opts.maxFailures 触发锁定的失败次数阈值（新计数达此值即锁）
   * @param opts.lockSec 锁定时长（秒）
   */
  async recordFailure(
    key: string,
    opts: { now: number; windowSec: number; maxFailures: number; lockSec: number },
  ): Promise<void> {
    const now = BigInt(opts.now);
    const windowSec = BigInt(opts.windowSec);
    const lockSec = BigInt(opts.lockSec);
    const { maxFailures } = opts;
    // 新计数（窗内 +1 / 窗外归 1）的 CASE 在 failed_count 与 locked_until 两处保持一致，
    // 故 locked_until 复算同一 CASE 再与阈值比较——避免引用尚未落库的新 failed_count。
    // 绑定参数显式 ::bigint / ::int：driver 把 JS 值绑为 unknown 类型，`$now + $lockSec` 这类纯参数运算
    // 会因 PG「operator is not unique: unknown + unknown」(42725) 失败，故逐个标注类型消歧。
    await this.db.$executeRaw`
      INSERT INTO login_attempts (key, failed_count, locked_until, last_attempt_at, updated_at)
      VALUES (
        ${key},
        1,
        CASE WHEN 1 >= ${maxFailures}::int THEN ${now}::bigint + ${lockSec}::bigint ELSE NULL END,
        ${now}::bigint,
        ${now}::bigint
      )
      ON CONFLICT (key) DO UPDATE SET
        failed_count = CASE
          WHEN ${now}::bigint - login_attempts.last_attempt_at <= ${windowSec}::bigint
          THEN login_attempts.failed_count + 1
          ELSE 1
        END,
        locked_until = CASE
          WHEN (
            CASE
              WHEN ${now}::bigint - login_attempts.last_attempt_at <= ${windowSec}::bigint
              THEN login_attempts.failed_count + 1
              ELSE 1
            END
          ) >= ${maxFailures}::int
          THEN ${now}::bigint + ${lockSec}::bigint
          ELSE NULL
        END,
        last_attempt_at = ${now}::bigint,
        updated_at = ${now}::bigint
    `;
  }

  /**
   * 登录成功后清除某限流桶的失败计数。
   * @param key 限流桶键（`email:` / `ip:` 前缀）
   */
  async clear(key: string): Promise<void> {
    await this.db.login_attempts.deleteMany({ where: { key } });
  }
}
