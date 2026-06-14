import type { Metadata } from 'next';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = { title: '登录' };
// 读 cookie / 校验会话，禁止预渲染
export const dynamic = 'force-dynamic';

/** 登录页（公开）。已登录访问会被中间件重定向回首页。 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <LoginForm next={safeNext} />
    </div>
  );
}
