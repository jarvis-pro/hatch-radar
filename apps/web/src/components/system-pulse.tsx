import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DashboardData } from '@hatch-radar/shared';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api } from '@/api/client';

/**
 * 系统脉搏（顶栏常驻）：在线 Worker 数 + 在飞任务数（排队 + 运行中），让整套系统「看起来活着」。
 * 与看板「系统健康」共用同一份数据——复用 ['dashboard'] 查询缓存（同 key 去重），10s 轮询；
 * 文案与看板对齐（Worker / 在飞）；失败或无数据时静默不显示。
 * 由 TopBar 在「有 insights:view 权限且不在看板页」时挂载：看板已完整展示，顶栏不再重复（且避免自链接）。
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
      to="/"
      title="系统脉搏 · Worker 在线数 / 在飞任务（排队 + 运行中）· 点击查看看板"
      className="hidden h-8 items-center gap-2.5 rounded-md border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:inline-flex"
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
        在飞 <span className="font-medium text-foreground">{inflight}</span>
      </span>
    </Link>
  );
}
