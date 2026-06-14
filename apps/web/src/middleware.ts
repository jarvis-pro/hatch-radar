import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/constants';

/** 公开路径（无需登录）。 */
const PUBLIC = ['/login'];

function isPublic(pathname: string): boolean {
  return PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * 粗筛闸：未登录（无会话 cookie）访问受保护页 → 跳 /login?next=；已登录访问 /login → 回首页。
 * 权威校验（会话有效性 / 权限 / 强制改密）在数据层（guards + 各页）完成——中间件只看 cookie 是否存在。
 * /api/* 不在此拦截：由各 route handler 自行鉴权（返回 401/403 而非 302）。
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (hasSession && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (!hasSession && !isPublic(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // 排除 api、Next 内部资源与静态文件
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
