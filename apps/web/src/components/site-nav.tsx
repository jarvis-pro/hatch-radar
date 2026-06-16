import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { hasPermission, type CurrentUser, type PermissionKey } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { api } from '@/api/client';

/** 导航项 + 所需能力（无权则不显示）；区段匹配高亮当前所在。 */
const LINKS: { to: string; label: string; perm: PermissionKey; match: (p: string) => boolean }[] = [
  {
    to: '/dashboard',
    label: '看板',
    perm: 'insights:view',
    match: (p) => p.startsWith('/dashboard'),
  },
  {
    to: '/',
    label: '洞察',
    perm: 'insights:view',
    match: (p) => p === '/' || p.startsWith('/insights'),
  },
  { to: '/posts', label: '帖子', perm: 'posts:view', match: (p) => p.startsWith('/posts') },
  { to: '/analyze', label: '分析', perm: 'analyze:run', match: (p) => p.startsWith('/analyze') },
  { to: '/queue', label: '队列', perm: 'analyze:run', match: (p) => p.startsWith('/queue') },
  {
    to: '/settings',
    label: '设置',
    perm: 'settings:manage',
    match: (p) => p.startsWith('/settings'),
  },
];

/** 顶部导航：按当前用户权限显隐，高亮所在区段；「队列」项展示在飞任务数红点。 */
export function SiteNav({ user }: { user: CurrentUser }) {
  const { pathname } = useLocation();
  const links = LINKS.filter((l) => hasPermission(user.role, user.permissions, l.perm));
  const canQueue = links.some((l) => l.to === '/queue');

  // 在飞任务数（排队 + 运行中）：可见「队列」项才轮询；入队操作会 invalidate ['queue-inflight'] 即时刷新
  const inflightQ = useQuery({
    queryKey: ['queue-inflight'],
    queryFn: () => api.get<{ stats: { queued: number; running: number } }>('/analysis/jobs'),
    refetchInterval: 5000,
    enabled: canQueue,
  });
  const inflight = canQueue
    ? (inflightQ.data?.stats.queued ?? 0) + (inflightQ.data?.stats.running ?? 0)
    : 0;

  return (
    <nav className="flex items-center gap-1">
      {links.map((l) => (
        <Button key={l.to} asChild variant={l.match(pathname) ? 'secondary' : 'ghost'} size="sm">
          <Link to={l.to} className="relative">
            {l.label}
            {l.to === '/queue' && inflight > 0 ? (
              <Badge
                variant="destructive"
                className="absolute -top-1.5 -right-1.5 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none tabular-nums ring-2 ring-background"
              >
                {inflight > 99 ? '99+' : inflight}
              </Badge>
            ) : null}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
