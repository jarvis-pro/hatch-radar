import 'server-only';
import { getDb } from '@/lib/db';
import { nowSec } from './constants';

/** 滑动窗内达到此失败次数即锁定。 */
const MAX_FAILURES = 5;
/** 滑动窗（秒）：上次失败超过此时长则失败计数从头算。 */
const WINDOW_SEC = 900;
/** 锁定时长（秒）。 */
const LOCK_SEC = 300;

/**
 * 邮箱当前的登录锁定剩余秒数；未锁返回 0。
 * @param email 归一小写邮箱
 */
export async function loginLockRemaining(email: string): Promise<number> {
  const row = await getDb().login_attempts.findUnique({ where: { email } });
  if (!row || row.locked_until == null) return 0;
  const remaining = Number(row.locked_until) - nowSec();
  return remaining > 0 ? remaining : 0;
}

/** 记一次登录失败；滑动窗内累计达阈值则锁定一段时间。 */
export async function recordLoginFailure(email: string): Promise<void> {
  const db = getDb();
  const now = nowSec();
  const row = await db.login_attempts.findUnique({ where: { email } });
  // 上次失败超过窗口 → 计数重置；否则累加
  const base = row && now - Number(row.last_attempt_at) <= WINDOW_SEC ? row.failed_count : 0;
  const failed = base + 1;
  const lockedUntil = failed >= MAX_FAILURES ? BigInt(now + LOCK_SEC) : null;
  await db.login_attempts.upsert({
    where: { email },
    create: {
      email,
      failed_count: failed,
      locked_until: lockedUntil,
      last_attempt_at: BigInt(now),
      updated_at: BigInt(now),
    },
    update: {
      failed_count: failed,
      locked_until: lockedUntil,
      last_attempt_at: BigInt(now),
      updated_at: BigInt(now),
    },
  });
}

/** 登录成功后清除该邮箱的失败计数。 */
export async function clearLoginAttempts(email: string): Promise<void> {
  await getDb().login_attempts.deleteMany({ where: { email } });
}
