/**
 * 请求闸（/radar/requests）—— 所有外站请求的共享收口与执行计划。
 *
 * 横切所有进程：reddit/hackernews/rss/ai 各一道 lane，实时速率/队列深度/ETA + 暂停恢复。
 * 暂停某 lane → 该 lane 的 fetch 请求停在 pending、owner 环节 park（等放行）→ 相关运行肉眼变慢。
 * 这条「抓取环节 ↔ 请求行 ↔ lane 限速」的因果，是请求闸的精髓。
 */
import { Pause, Play } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Card } from '@hatch-radar/ui/components/card';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import type { LaneDTO, RadarLaneId, RequestRowDTO } from '@hatch-radar/shared';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { fmtDuration } from '@/lib/format';
import { LANE_META, stageLabel } from './constants';
import { useLanes } from './hooks';
import { usePauseLane } from './mutations';

const REQ_STATUS: Record<string, { label: string; dot: string }> = {
  pending: { label: '等待', dot: 'bg-intensity-medium' },
  running: { label: '执行中', dot: 'bg-primary' },
  done: { label: '完成', dot: 'bg-muted-foreground' },
  failed: { label: '失败', dot: 'bg-intensity-high' },
  canceled: { label: '取消', dot: 'bg-muted-foreground/30' },
};
function reqStatusMeta(s: string): { label: string; dot: string } {
  return REQ_STATUS[s] ?? { label: s, dot: 'bg-muted-foreground/30' };
}

function ReqRow({ req }: { req: RequestRowDTO }) {
  const st = reqStatusMeta(req.status);
  const nowSec = Date.now() / 1000;
  const age =
    req.status === 'running' && req.startedAt != null
      ? `${Math.max(0, Math.round(nowSec - req.startedAt))}s`
      : '';
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          req.status === 'running' && 'signal-pulse',
          st.dot,
        )}
      />
      <span className="shrink-0 font-medium">{stageLabel(req.purpose)}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{req.detail}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground/70">{age}</span>
      <span className="w-12 shrink-0 text-right text-muted-foreground">{st.label}</span>
    </div>
  );
}

/** lane 视觉词表兜底（后端可能返回未登记 lane id）。 */
const FALLBACK_LANE_META = {
  label: '其他',
  icon: Pause,
  color: 'text-muted-foreground',
  bar: 'bg-muted-foreground',
} as const;
function laneMeta(id: string) {
  return LANE_META[id as RadarLaneId] ?? FALLBACK_LANE_META;
}

function LaneCard({
  lane,
  onToggle,
  disabled,
}: {
  lane: LaneDTO;
  onToggle: (lane: LaneDTO) => void;
  disabled: boolean;
}) {
  const { rate, depth, etaSec, recent } = lane;
  const meta = laneMeta(lane.id);
  const Icon = meta.icon;
  const util = lane.ratePerMin > 0 ? Math.min(100, (rate / lane.ratePerMin) * 100) : 0;
  const list = recent.slice(0, 9);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-2 font-medium', meta.color)}>
          <Icon className="size-4" />
          {lane.label}
        </span>
        <div className="flex items-center gap-2">
          {lane.paused ? <Badge variant="secondary">已暂停</Badge> : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={lane.paused ? '恢复 lane' : '暂停 lane'}
            disabled={disabled}
            onClick={() => onToggle(lane)}
          >
            {lane.paused ? (
              <Play className="size-3.5 text-intensity-medium" />
            ) : (
              <Pause className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
        <span>
          速率 <span className="font-medium text-foreground">{rate}</span>/min
        </span>
        <span>
          队列 <span className="font-medium text-foreground">{depth}</span>
        </span>
        <span>
          排空{' '}
          {lane.paused
            ? '—'
            : etaSec != null
              ? `~${fmtDuration(etaSec)}`
              : depth > 0
                ? '—'
                : '空闲'}
        </span>
        <span className="ml-auto">上限 {lane.ratePerMin}/min</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', lane.paused ? 'bg-muted-foreground/40' : meta.bar)}
          style={{ width: `${lane.paused ? 100 : util}%` }}
        />
      </div>

      <div className="divide-y rounded-md border bg-background px-2">
        {list.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground/60">暂无请求</p>
        ) : (
          list.map((r) => <ReqRow key={r.id} req={r} />)
        )}
      </div>
    </Card>
  );
}

function RequestGate() {
  const q = useLanes();
  const pauseLane = usePauseLane();

  if (q.isError) return <LoadError onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96 w-full" />;

  const lanes = q.data;
  const anyPaused = lanes.some((l) => l.paused);
  const toggle = (lane: LaneDTO) => pauseLane.mutate({ lane: lane.id, paused: !lane.paused });

  return (
    <>
      <PageHeader
        title="请求闸"
        description="所有外站请求的共享收口：按 lane 限速、排队、可暂停。暂停某 lane，相关运行的抓取环节会停在「等放行」。"
      />
      <div className="mb-4 flex items-center gap-2">
        <Button
          size="sm"
          variant={anyPaused ? 'default' : 'outline'}
          disabled={pauseLane.isPending || lanes.length === 0}
          onClick={() => lanes.forEach((l) => pauseLane.mutate({ lane: l.id, paused: !anyPaused }))}
        >
          {anyPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {anyPaused ? '全部恢复' : '全部暂停'}
        </Button>
        <span className="text-xs text-muted-foreground">
          降低封控的全局闸门——单实例放行、按 lane 限速。
        </span>
      </div>
      {lanes.length === 0 ? (
        <EmptyState title="无 lane" hint="" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lanes.map((lane) => (
            <LaneCard key={lane.id} lane={lane} onToggle={toggle} disabled={pauseLane.isPending} />
          ))}
        </div>
      )}
    </>
  );
}

export function RequestGatePage() {
  return (
    <RequirePerm perm="analyze:run">
      <RequestGate />
    </RequirePerm>
  );
}
