import type { Metadata } from 'next';
import Link from 'next/link';
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
