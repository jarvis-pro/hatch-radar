import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Radar } from 'lucide-react';
// @hatch-radar/ui 提供 Tailwind v4 + shadcn 主题（含 base 层 bg-background / text-foreground）
import '@hatch-radar/ui/globals.css';
import { ModeToggle } from '@hatch-radar/ui/components/mode-toggle';
import { ThemeProvider } from '@hatch-radar/ui/components/theme-provider';
import { SiteNav } from '@/components/site-nav';
import { UserMenu } from '@/components/user-menu';
import { getCurrentUser } from '@/lib/auth/current-user';
import type { PublicUser } from '@/lib/auth/types';

export const metadata: Metadata = {
  title: { default: 'Hatch Radar 控制台', template: '%s · Hatch Radar' },
  description: '社区痛点与产品机会雷达 —— 只读控制台',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // 顶栏据登录态渲染：未登录（仅 /login 可达）只显示 Logo + 主题切换
  const user = await getCurrentUser();
  const publicUser: PublicUser | null = user
    ? { name: user.name, email: user.email, role: user.role, permissions: user.permissions }
    : null;
  return (
    // suppressHydrationWarning：next-themes 在水合前给 <html> 注入 class，避免不匹配告警
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
            <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <Radar className="size-5 text-primary" />
                Hatch Radar
              </Link>
              <div className="flex items-center gap-1">
                {publicUser ? <SiteNav user={publicUser} /> : null}
                <ModeToggle />
                {publicUser ? <UserMenu user={publicUser} /> : null}
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
          <footer className="border-t">
            <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground">
              控制台 · 数据由工作台 server 进程（爬取 + AI 分析）产出
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
