/**
 * 指挥室首页（/radar）—— 这台情报雷达「此刻在干什么」。
 *
 * 四块：今日收成（新帖/洞察/运行/在途）· 请求闸实时（各 lane 速率/深度，可暂停）·
 * 活跃进程（脉动 + 当前运行进度 + 立即触发）· 告警（最近失败运行）。
 * 全部订阅活的 world，每帧重渲染——打开就看到它在动。
 */
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Gauge,
  Inbox,
  Pause,
  Play,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Card } from '@hatch-radar/ui/components/card';
import { Progress } from '@hatch-radar/ui/components/progress';
import { toast } from '@hatch-radar/ui/components/sonner';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { ClockBar } from './clock-bar';
import { KIND_META, LANE_META, TRIGGER_META } from './constants';
import { pauseLane, setProcessStatus, triggerProcess, useWorld } from './store';
import type { World } from './types';
import { relFuture, relPast, triggerSummary } from './util';

function selectControlRoom(w: World) {
  const sod = new Date(w.nowMs);
  sod.setHours(0, 0, 0, 0);
  const dayStart = sod.getTime();

  const insightsToday = w.insights.filter((i) => i.createdAt >= dayStart).length;
  const postsToday = w.tasks.filter(
    (t) => t.kind === 'collect' && t.status === 'succeeded' && (t.finishedAt ?? 0) >= dayStart,
  ).length;
  const runsToday = w.runs.filter((r) => r.startedAt >= dayStart).length;
  const inflight = w.tasks.filter(
    (t) => t.status === 'running' || t.status === 'queued' || t.status === 'paused',
  ).length;

  const lanes = w.lanes.map((l) => ({
    id: l.id,
    paused: l.paused,
    rate: l.recentReleases.length,
    ratePerMin: l.ratePerMin,
    depth: w.requests.filter((r) => r.lane === l.id && (r.status === 'pending' || r.status === 'running'))
      .length,
  }));

  const processes = w.processes.map((p) => {
    const run = w.runs.find((r) => r.processId === p.id && r.status === 'running') ?? null;
    const blueprint = w.blueprints.find((b) => b.id === p.blueprintId) ?? null;
    let total = 0;
    let done = 0;
    if (run) {
      const ts = w.tasks.filter((t) => t.runId === run.id);
      total = ts.length;
      done = ts.filter((t) => t.status === 'succeeded' || t.status === 'skipped').length;
    }
    const latest =
      run ?? w.runs.filter((r) => r.processId === p.id).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
    return { p, blueprint, run, total, done, latestRunId: latest?.id ?? null };
  });

  const alerts = w.runs
    .filter((r) => r.status === 'failed')
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .slice(0, 4)
    .map((r) => ({
      id: r.id,
      error: r.error,
      finishedAt: r.finishedAt,
      label: w.processes.find((p) => p.id === r.processId)?.label ?? r.processId,
    }));

  return { insightsToday, postsToday, runsToday, inflight, lanes, processes, alerts, nowMs: w.nowMs };
}

type CRData = ReturnType<typeof selectControlRoom>;

// ─── 请求闸实时（lane 速率/深度，可暂停） ──────────────────────────────────────

function LaneRow({ lane }: { lane: CRData['lanes'][number] }) {
  const meta = LANE_META[lane.id];
  const Icon = meta.icon;
  const util = lane.ratePerMin > 0 ? Math.min(100, (lane.rate / lane.ratePerMin) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={cn('inline-flex w-28 shrink-0 items-center gap-1.5 text-sm font-medium', meta.color)}>
        <Icon className="size-4" />
        {meta.label}
      </span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', lane.paused ? 'bg-muted-foreground/40' : meta.bar)}
          style={{ width: `${lane.paused ? 100 : util}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {lane.rate}/min · 队 {lane.depth}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0"
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
  );
}

// ─── 活跃进程卡（脉动 + 当前运行进度 + 立即触发） ──────────────────────────────

function ProcessRow({ row, nowMs }: { row: CRData['processes'][number]; nowMs: number }) {
  const navigate = useNavigate();
  const { p, blueprint, run, total, done, latestRunId } = row;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const TriggerIcon = TRIGGER_META[p.trigger.kind].icon;

  const open = (): void => {
    if (run) navigate(`/radar/runs/${run.id}`);
    else if (latestRunId) navigate(`/radar/runs/${latestRunId}`);
    else navigate(`/radar/processes/${p.id}/runs`);
  };

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              run ? 'signal-pulse bg-primary' : p.status === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/50',
            )}
          />
          <span className="truncate font-medium hover:text-primary">{p.label}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={p.status === 'active' ? '暂停调度' : '恢复调度'}
            onClick={() => setProcessStatus(p.id, p.status === 'active' ? 'paused' : 'active')}
          >
            {p.status === 'active' ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="立即触发"
            onClick={() => {
              triggerProcess(p.id);
              toast.success('已触发一次运行');
            }}
          >
            <Zap className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-x-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <TriggerIcon className="size-3.5" />
          {triggerSummary(p.trigger)}
        </span>
        {blueprint ? (
          <span className="min-w-0 truncate">{KIND_META[blueprint.kind].label} · {blueprint.label}</span>
        ) : null}
        <Link
          to={`/radar/processes/${p.id}/runs`}
          className="ml-auto shrink-0 underline-offset-2 hover:text-foreground hover:underline"
        >
          历史
        </Link>
      </div>

      {run ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <Badge variant="default" className="gap-1">
              <Activity className="size-3" /> 运行中
            </Badge>
            <span className="tabular-nums text-muted-foreground">
              {done}/{total} 任务 · {pct}%
            </span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{p.status === 'active' ? '待下次触发' : '已暂停'}</span>
          <span className="tabular-nums">
            {p.status === 'active' && p.nextRunAt ? relFuture(p.nextRunAt, nowMs) : '—'}
          </span>
        </div>
      )}
    </Card>
  );
}

// ─── 页面 ──────────────────────────────────────────────────────────────────────

function ControlRoom() {
  const d = useWorld(selectControlRoom);
  return (
    <>
      <PageHeader
        title="指挥室"
        description="这台情报雷达此刻在干什么——实时进程、出站请求、今日收成，一屏掌握。"
        actions={<ClockBar />}
      />

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="今日新帖" value={d.postsToday} icon={Inbox} hint="采集任务完成数" />
          <Link to="/radar/insights" className="block transition-opacity hover:opacity-80">
            <StatCard label="今日洞察" value={d.insightsToday} icon={Sparkles} hint="分析产出 · 看收成 →" />
          </Link>
          <StatCard label="在途任务" value={d.inflight} icon={Activity} hint="运行 + 排队 + 暂停" />
          <StatCard label="今日运行" value={d.runsToday} icon={Gauge} hint="各进程触发次数" />
        </div>

        <Card className="gap-1 p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
              <Gauge className="size-4 text-muted-foreground" /> 请求闸 · 实时
            </h2>
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
              <Link to="/radar/requests">
                执行计划 <ChevronRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          <div className="divide-y">
            {d.lanes.map((l) => (
              <LaneRow key={l.id} lane={l} />
            ))}
          </div>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-semibold">活跃进程</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-3">
            {d.processes.map((row) => (
              <ProcessRow key={row.p.id} row={row} nowMs={d.nowMs} />
            ))}
          </div>
        </div>

        {d.alerts.length > 0 ? (
          <Card className="gap-2 border-destructive/30 p-4">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" /> 告警 · 最近失败运行
            </h2>
            <div className="space-y-1.5">
              {d.alerts.map((a) => (
                <Link
                  key={a.id}
                  to={`/radar/runs/${a.id}`}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{a.label}</span>
                    <span className="text-muted-foreground"> · {a.error}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {a.finishedAt ? relPast(a.finishedAt, d.nowMs) : ''}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

export function ControlRoomPage() {
  return (
    <RequirePerm perm="analyze:run">
      <ControlRoom />
    </RequirePerm>
  );
}
