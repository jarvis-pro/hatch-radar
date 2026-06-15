import { Link, useLocation } from 'react-router-dom';
import { hasPermission, type CurrentUser, type PermissionKey } from '@hatch-radar/shared';
import { Button } from '@hatch-radar/ui/components/button';

/** 导航项 + 所需能力（无权则不显示）；区段匹配高亮当前所在。 */
const LINKS: { to: string; label: string; perm: PermissionKey; match: (p: string) => boolean }[] = [
  {
    to: '/',
    label: '洞察',
    perm: 'insights:view',
    match: (p) => p === '/' || p.startsWith('/insights'),
  },
  { to: '/posts', label: '帖子', perm: 'posts:view', match: (p) => p.startsWith('/posts') },
  { to: '/analyze', label: '分析', perm: 'analyze:run', match: (p) => p.startsWith('/analyze') },
  {
    to: '/settings',
    label: '设置',
    perm: 'settings:manage',
    match: (p) => p.startsWith('/settings'),
  },
];

/** 顶部导航：按当前用户权限显隐，高亮所在区段。 */
export function SiteNav({ user }: { user: CurrentUser }) {
  const { pathname } = useLocation();
  const links = LINKS.filter((l) => hasPermission(user.role, user.permissions, l.perm));
  return (
    <nav className="flex items-center gap-1">
      {links.map((l) => (
        <Button key={l.to} asChild variant={l.match(pathname) ? 'secondary' : 'ghost'} size="sm">
          <Link to={l.to}>{l.label}</Link>
        </Button>
      ))}
    </nav>
  );
}
