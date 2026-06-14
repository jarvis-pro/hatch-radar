import 'server-only';
import { generateSessionToken, hashSessionToken } from '@hatch-radar/auth';
import { isPermissionKey, type UserRole } from '@hatch-radar/shared';
import { getDb } from '@/lib/db';
import { nowSec } from './constants';
import type { CurrentUser } from './types';

const DAY = 86_400;

function envDays(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 空闲过期窗（默认 7 天）：每次活跃滑动续期到 now + 此值。 */
const IDLE_TTL = envDays('SESSION_IDLE_DAYS', 7) * DAY;
/** 绝对过期窗（默认 30 天）：自创建起的硬上限，滑动续期不得超过。 */
const ABSOLUTE_TTL = envDays('SESSION_ABSOLUTE_DAYS', 30) * DAY;
/** 滑动续期写库的最小间隔（秒）：last_seen 在此区间内不重复 update，省写。 */
const SLIDE_THROTTLE = 60;

/** 新建会话，返回原始 token（仅此一次可得，须写入 cookie）。 */
export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<string> {
  const token = generateSessionToken();
  const now = nowSec();
  await getDb().sessions.create({
    data: {
      user_id: userId,
      token_hash: hashSessionToken(token),
      expires_at: BigInt(now + IDLE_TTL),
      last_seen_at: BigInt(now),
      user_agent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      created_at: BigInt(now),
    },
  });
  return token;
}

/**
 * 解析会话 token → 当前用户（含权限）。
 * 无效 / 过期 / 账户停用一律返回 null，并顺手清理坏会话；活跃则滑动续期（限频写库）。
 */
export async function resolveSession(token: string): Promise<CurrentUser | null> {
  const db = getDb();
  const now = nowSec();
  const session = await db.sessions.findUnique({ where: { token_hash: hashSessionToken(token) } });
  if (!session) return null;
  if (Number(session.expires_at) <= now) {
    await db.sessions.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  const user = await db.users.findUnique({
    where: { id: session.user_id },
    include: { permissions: true },
  });
  if (!user || user.status !== 'active') {
    await db.sessions.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (now - Number(session.last_seen_at) >= SLIDE_THROTTLE) {
    const nextExpiry = Math.min(now + IDLE_TTL, Number(session.created_at) + ABSOLUTE_TTL);
    await db.sessions
      .update({
        where: { id: session.id },
        data: { last_seen_at: BigInt(now), expires_at: BigInt(nextExpiry) },
      })
      .catch(() => undefined);
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    status: user.status,
    mustChangePassword: user.must_change_password,
    permissions: user.permissions.map((p) => p.permission).filter(isPermissionKey),
    sessionId: session.id,
  };
}

/** 吊销指定 token 的会话（登出）。 */
export async function revokeSessionByToken(token: string): Promise<void> {
  await getDb().sessions.deleteMany({ where: { token_hash: hashSessionToken(token) } });
}

/** 吊销某用户除保留会话外的全部会话（改密 / 「登出其他会话」）。 */
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  await getDb().sessions.deleteMany({ where: { user_id: userId, id: { not: keepSessionId } } });
}

/** 某用户当前未过期的会话列表（个人中心展示）。 */
export async function listUserSessions(userId: string) {
  const rows = await getDb().sessions.findMany({
    where: { user_id: userId, expires_at: { gt: BigInt(nowSec()) } },
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
