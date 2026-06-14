import 'server-only';
import { cache } from 'react';
import { readSessionCookie } from './cookies';
import { resolveSession } from './session';
import type { CurrentUser } from './types';

/**
 * 当前请求的登录用户（用 React cache 按请求记忆，多处调用只解析一次）。
 * 未登录 / 会话失效 / DB 暂不可用均返回 null——调用方（middleware/guards/页面）据此处理。
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionCookie();
  if (!token) return null;
  try {
    return await resolveSession(token);
  } catch {
    return null;
  }
});
