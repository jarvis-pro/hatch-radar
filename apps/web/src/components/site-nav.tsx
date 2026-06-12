'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@hatch-radar/ui/components/button';

/** 区段匹配：洞察含详情页 /insights/*，帖子含 /posts/* */
const LINKS = [
  { href: '/', label: '洞察', match: (p: string) => p === '/' || p.startsWith('/insights') },
  { href: '/posts', label: '帖子', match: (p: string) => p.startsWith('/posts') },
  { href: '/analyze', label: '回填', match: (p: string) => p.startsWith('/analyze') },
];

/** 顶部导航：高亮当前所在区段 */
export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => (
        <Button key={l.href} asChild variant={l.match(pathname) ? 'secondary' : 'ghost'} size="sm">
          <Link href={l.href}>{l.label}</Link>
        </Button>
      ))}
    </nav>
  );
}
