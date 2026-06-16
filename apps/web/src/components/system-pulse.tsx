import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DashboardData } from '@hatch-radar/shared';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api } from '@/api/client';

/**
 * 系统脉搏（顶栏常驻）：在线 Worker 数 + 在飞任务数，让整套系统「看起来活着」。
 * 复用看板的 ['dashboard'] 查询缓存（同 key 去重），10s 轮询；失败/无数据静默不显示。
 * 仅在调用方确认有 insights:view 权限时挂载（/dashboard 端点需该权限）。
 */
export function SystemPulse() {
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    refetchInterval: 10_000,
  });

  const d = q.data;
  if (!d) return null;

  const workers = d.workers.length;
  const inflight = d.queue.queued + d.queue.running;
  const online = workers > 0;

  return (
    <Link
      to="/dashboard"
      title="系统脉搏 · 点击查看看板"
      className="hidden items-center gap-2.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:inline-flex"
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            online ? 'signal-pulse bg-signal' : 'bg-muted-foreground/50',
          )}
        />
        <span className="tabular-nums">
          Worker <span className="font-medium text-foreground">{workers}</span>
        </span>
      </span>
      <span className="text-border">|</span>
      <span className="tabular-nums">
        队列 <span className="font-medium text-foreground">{inflight}</span>
      </span>
    </Link>
  );
}
