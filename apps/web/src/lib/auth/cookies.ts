import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from './constants';

const DAY = 86_400;

/** cookie 绝对存活天数（与会话绝对过期同源，默认 30）。 */
function absoluteDays(): number {
  const v = Number(process.env.SESSION_ABSOLUTE_DAYS);
  return Number.isFinite(v) && v > 0 ? v : 30;
}

/** 写会话 cookie（HttpOnly + 生产 Secure + SameSite=Lax）。仅可在 action / route handler 调用。 */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: absoluteDays() * DAY,
  });
}

/** 清除会话 cookie（登出）。 */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** 读会话 cookie 原始 token（可在 RSC / action 调用）。 */
export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}
