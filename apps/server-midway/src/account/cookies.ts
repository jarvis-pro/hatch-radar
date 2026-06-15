import type { Context } from '@midwayjs/koa';

/** 会话 cookie 名（与 NestJS 版一致）。 */
export const SESSION_COOKIE = 'radar_session';

/**
 * 写操作要求的自定义请求头（CSRF 兜底）：同源 SPA 的 api 客户端恒带此头。
 * 与 NestJS 版一致。
 */
export const CSRF_HEADER = 'x-radar-csrf';

const DAY = 86_400;

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 写会话 cookie（HttpOnly + 生产 Secure + SameSite=Lax）。koa cookies.set，与 NestJS/express 版语义一致。 */
export function setSessionCookie(ctx: Context, token: string, absoluteDays: number): void {
  ctx.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: absoluteDays * DAY * 1000,
    signed: false,
    overwrite: true,
  });
}

/** 清除会话 cookie（登出）。 */
export function clearSessionCookie(ctx: Context): void {
  ctx.cookies.set(SESSION_COOKIE, null, { path: '/', signed: false });
}

/**
 * 从请求头解析会话 token（不引 cookie 签名机制：仅读一个不透明 token，手解析足矣，与 NestJS 版逐字一致）。
 * @returns cookie 值；缺失返回 undefined
 */
export function readSessionCookie(ctx: { headers?: { cookie?: string } }): string | undefined {
  const header = ctx.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === SESSION_COOKIE) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}
