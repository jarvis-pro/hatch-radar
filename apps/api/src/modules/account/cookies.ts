import type { Request, Response } from 'express';

/** 会话 cookie 名（与原 web 实现一致，mobile 不涉及）。 */
export const SESSION_COOKIE = 'radar_session';

/**
 * 写操作要求的自定义请求头（CSRF 兜底）：同源 SPA 的 api 客户端恒带此头。
 * 跨站表单 / 图片等无法设置自定义头，结合 SameSite=Lax + 同源即可挡住 CSRF。
 */
export const CSRF_HEADER = 'x-radar-csrf';

const DAY = 86_400;
/** 启用 Secure 时的 cookie 名：__Host- 前缀强制 Secure + path=/ + 无 domain，防子域 cookie 注入 / 固定。 */
const HOST_COOKIE = `__Host-${SESSION_COOKIE}`;

/**
 * 是否签发 Secure cookie：COOKIE_SECURE 显式覆盖（'true'/'false'）优先，否则回落 NODE_ENV==='production'。
 * 独立开关杜绝「生产容器忘设 NODE_ENV → 会话 cookie 无 Secure、明文 HTTP 下被嗅探」。
 */
function cookieSecure(): boolean {
  const override = process.env.COOKIE_SECURE?.trim();
  if (override) return override === 'true';
  return process.env.NODE_ENV === 'production';
}

/** 当前应签发的 cookie 名：Secure 用 __Host- 前缀；非 Secure（本地 http dev）浏览器拒绝该前缀，用裸名。 */
function activeCookieName(): string {
  return cookieSecure() ? HOST_COOKIE : SESSION_COOKIE;
}

/** 写会话 cookie（HttpOnly + Secure(可配置) + SameSite=Lax；Secure 时带 __Host- 前缀）。 */
export function setSessionCookie(res: Response, token: string, absoluteDays: number): void {
  res.cookie(activeCookieName(), token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: absoluteDays * DAY * 1000, // express 用毫秒
  });
}

/** 清除会话 cookie（登出）：两种名都清，覆盖 Secure 切换前后签发的 cookie。 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(HOST_COOKIE, { path: '/' });
}

/**
 * 从请求头解析会话 token（不引 cookie-parser：仅读一个不透明 token，手解析足矣）。
 * @returns cookie 值；缺失返回 undefined
 */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  let base: string | undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    // __Host- 前缀名优先（Secure 部署）；回退裸名（dev / Secure 切换前的旧 cookie）。
    if (key === HOST_COOKIE) return decodeURIComponent(part.slice(idx + 1).trim());
    if (key === SESSION_COOKIE) base = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return base;
}
