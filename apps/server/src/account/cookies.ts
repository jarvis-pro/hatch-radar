import type { Request, Response } from 'express';

/** 会话 cookie 名（与原 web 实现一致，mobile 不涉及）。 */
export const SESSION_COOKIE = 'radar_session';

/**
 * 写操作要求的自定义请求头（CSRF 兜底）：同源 SPA 的 api 客户端恒带此头。
 * 跨站表单 / 图片等无法设置自定义头，结合 SameSite=Lax + 同源即可挡住 CSRF。
 */
export const CSRF_HEADER = 'x-radar-csrf';

const DAY = 86_400;

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 写会话 cookie（HttpOnly + 生产 Secure + SameSite=Lax；server 端到端持有）。 */
export function setSessionCookie(res: Response, token: string, absoluteDays: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: absoluteDays * DAY * 1000, // express 用毫秒
  });
}

/** 清除会话 cookie（登出）。 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * 从请求头解析会话 token（不引 cookie-parser：仅读一个不透明 token，手解析足矣）。
 * @returns cookie 值；缺失返回 undefined
 */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === SESSION_COOKIE) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}
