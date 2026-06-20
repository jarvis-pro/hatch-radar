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
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { LANE_META, stageLabel } from './constants';
import { pauseLane, useWorld } from './store';
import type { RequestRow, World } from './types';
import { fmtDur } from './util';

function selectLanes(w: World) {
  return w.lanes.map((l) => {
    const reqs = w.requests.filter((r) => r.lane === l.id);
    const pending = reqs.filter((r) => r.status === 'pending');
    const running = reqs.filter((r) => r.status === 'running');
    const recent = reqs
      .filter((r) => r.status === 'done' || r.status === 'failed')
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      .slice(0, 5);
    const depth = pending.length + running.length;
    const rate = l.recentReleases.length; // 近 60s 放行数 ≈ 每分钟速率
    const etaSec = rate > 0 ? (depth / rate) * 60 : null;
    return { lane: l, rate, depth, etaSec, running, pending, recent };
  });
}

const REQ_STATUS: Record<RequestRow['status'], { label: string; dot: string }> = {
  pending: { label: '等待', dot: 'bg-intensity-medium' },
  running: { label: '执行中', dot: 'bg-primary' },
  done: { label: '完成', dot: 'bg-muted-foreground' },
  failed: { label: '失败', dot: 'bg-intensity-high' },
};

function ReqRow({ req, nowMs }: { req: RequestRow; nowMs: number }) {
  const st = REQ_STATUS[req.status];
  const age =
    req.status === 'running' && req.releasedAt
      ? `${Math.round((nowMs - req.releasedAt) / 1000)}s`
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

function LaneCard({
  data,
  nowMs,
}: {
  data: ReturnType<typeof selectLanes>[number];
  nowMs: number;
}) {
  const { lane, rate, depth, etaSec, running, pending, recent } = data;
  const meta = LANE_META[lane.id];
  const Icon = meta.icon;
  const util = lane.ratePerMin > 0 ? Math.min(100, (rate / lane.ratePerMin) * 100) : 0;
  const list = [...running, ...pending, ...recent].slice(0, 9);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-2 font-medium', meta.color)}>
          <Icon className="size-4" />
          {meta.label}
        </span>
        <div className="flex items-center gap-2">
          {lane.paused ? <Badge variant="secondary">已暂停</Badge> : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={lane.paused ? '恢复 lane' : '暂停 lane'}
            onClick={() => pauseLane(lane.id, !lane.paused)}
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
              ? `~${fmtDur(etaSec * 1000)}`
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
          list.map((r) => <ReqRow key={r.id} req={r} nowMs={nowMs} />)
        )}
      </div>
    </Card>
  );
}

function RequestGate() {
  const lanes = useWorld(selectLanes);
  const nowMs = useWorld((w) => w.nowMs);
  const anyPaused = lanes.some((l) => l.lane.paused);

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
          onClick={() => lanes.forEach((l) => pauseLane(l.lane.id, !anyPaused))}
        >
          {anyPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {anyPaused ? '全部恢复' : '全部暂停'}
        </Button>
        <span className="text-xs text-muted-foreground">
          降低封控的全局闸门——单实例放行、按 lane 限速（mock 演示）。
        </span>
      </div>
      {lanes.length === 0 ? (
        <EmptyState title="无 lane" hint="" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lanes.map((d) => (
            <LaneCard key={d.lane.id} data={d} nowMs={nowMs} />
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
