import type { Metadata } from 'next';
import Link from 'next/link';
// ui 主题（Tailwind + shadcn 变量）在前，控制台手写样式在后（后者未分层，覆盖优先）
import '@hatch-radar/ui/globals.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'hatch-radar 控制台', template: '%s · hatch-radar' },
  description: '社区痛点与产品机会雷达 —— 只读控制台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              hatch-radar
            </Link>
            <nav className="site-nav">
              <Link href="/">洞察</Link>
              <Link href="/posts">帖子</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="container site-footer">
          只读控制台 · 数据由工作台 server 进程（爬取 + AI 分析）产出
        </footer>
      </body>
    </html>
  );
}
