import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ControlRoomDTO } from '@hatch-radar/shared';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api } from '@/api/client';
import { radarKeys } from '@/radar-lab/query-keys';

/**
 * 系统脉搏（顶栏常驻）：在线 Worker 数 + 在飞任务数（排队 + 运行 + 暂停），让整套系统「看起来活着」。
 * 运营数据已切分至指挥室——复用指挥室 ['radar','control-room'] 查询缓存（同 key 去重），10s 轮询；
 * 失败或无数据时静默不显示。由 TopBar 在「有 insights:view 权限且不在指挥室页」时挂载，点击进指挥室。
 */
export function SystemPulse() {
  const q = useQuery({
    queryKey: radarKeys.controlRoom,
    queryFn: () => api.get<ControlRoomDTO>('/radar/control-room'),
    refetchInterval: 10_000,
  });

  const d = q.data;
  if (!d) return null;

  const workers = d.today.workers;
  const inflight = d.today.inflight;
  const online = workers > 0;

  return (
    <Link
      to="/radar"
      title="系统脉搏 · Worker 在线数 / 在飞任务（排队 + 运行 + 暂停）· 点击进指挥室"
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
