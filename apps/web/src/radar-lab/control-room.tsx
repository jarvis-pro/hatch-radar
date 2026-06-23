/**
 * 指挥室首页（/radar）—— 这台情报雷达「此刻在干什么」+ 闭环各面的枢纽。
 *
 * 今日收成 · 请求闸实时 · 活跃进程（脉动/进度/触发/编辑删除/新建）· 告警。
 * 出链：今日洞察→收成、请求闸→执行计划、进程→运行详情/历史、图纸→定义端。
 * 数据经 react-query 命中 /api（指挥室聚合 3s 轮询出 live 感）。
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Gauge,
  Inbox,
  LayoutTemplate,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import type { BlueprintDTO, ControlRoomDTO, LaneDTO, RunDTO } from '@hatch-radar/shared';
import { Button } from '@hatch-radar/ui/components/button';
import { Card } from '@hatch-radar/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hatch-radar/ui/components/dropdown-menu';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import { ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { ConfirmDelete } from './confirm-delete';
import { KIND_META, LANE_META, TRIGGER_META } from './constants';
import { ProcessFormDialog } from './forms';
import { useBlueprints, useControlRoom } from './hooks';
import {
  useDeleteProcess,
  usePauseLane,
  useSetProcessStatus,
  useTriggerProcess,
} from './mutations';
import { relFuture, relPast, triggerSummary } from './util';

type CRProcess = ControlRoomDTO['processes'][number];

/** 复查退避桶（0=活跃，1~3=连未变 N，4=连未变 4+）。后端 dist 按 misses 原值返回，这里归桶展示。 */
function recheckBuckets(dist: { misses: number; count: number }[]): {
  level: number;
  label: string;
  interval: string;
  count: number;
}[] {
  return [0, 1, 2, 3, 4].map((l) => ({
    level: l,
    label: l === 0 ? '活跃' : l === 4 ? '连未变 4+' : `连未变 ${l}`,
    interval: l === 0 ? '每轮查' : `隔 ${Math.min(2 ** (l - 1), 16)} 轮`,
    count: dist
      .filter((d) => (l === 4 ? d.misses >= 4 : d.misses === l))
      .reduce((s, d) => s + d.count, 0),
  }));
}

function LaneRow({ lane }: { lane: LaneDTO }) {
  const meta = LANE_META[lane.id as keyof typeof LANE_META];
  const Icon = meta.icon;
  const pauseLane = usePauseLane();
  const util = lane.ratePerMin > 0 ? Math.min(100, (lane.rate / lane.ratePerMin) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={cn(
          'inline-flex w-28 shrink-0 items-center gap-1.5 text-sm font-medium',
          meta.color,
        )}
      >
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
        disabled={pauseLane.isPending}
        onClick={() => pauseLane.mutate({ lane: String(lane.id), paused: !lane.paused })}
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

function ProcessRow({ p, blueprints }: { p: CRProcess; blueprints: BlueprintDTO[] }) {
  const navigate = useNavigate();
  const trigger = useTriggerProcess();
  const setStatus = useSetProcessStatus();
  const del = useDeleteProcess();
  const run = p.activeRun;
  const total = run?.tasksTotal ?? 0;
  const done = run?.tasksDone ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const nowSec = Date.now() / 1000;
  // 待触发时进度条表示「距下次触发的进度」（蓄力 → 释放循环）：(周期 - 剩余) / 周期。
  const intervalSec =
    p.trigger.kind === 'interval' ? p.trigger.everySec : p.trigger.kind === 'cron' ? 3600 : 0;
  const countdownPct =
    p.status === 'active' && p.nextRunAt != null && intervalSec > 0
      ? Math.max(0, Math.min(100, (1 - (p.nextRunAt - nowSec) / intervalSec) * 100))
      : 0;
  const TriggerIcon = TRIGGER_META[p.trigger.kind].icon;
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  const open = (): void => {
    if (run) {
      navigate(`/radar/runs/${run.id}`);
    } else {
      navigate(`/radar/processes/${p.id}/runs`);
    }
  };

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              run
                ? 'signal-pulse bg-primary'
                : p.status === 'active'
                  ? 'bg-emerald-500'
                  : 'bg-muted-foreground/50',
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
            disabled={setStatus.isPending}
            onClick={() =>
              setStatus.mutate({
                id: String(p.id),
                status: p.status === 'active' ? 'paused' : 'active',
              })
            }
          >
            {p.status === 'active' ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="立即触发"
            disabled={trigger.isPending}
            onClick={() => trigger.mutate(String(p.id))}
          >
            <Zap className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label="进程操作"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={() => navigate(`/radar/processes/${p.id}/runs`)}>
                运行记录
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" /> 编辑节奏
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDelOpen(true)}>
                <Trash2 className="size-4" /> 删除进程
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-x-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <TriggerIcon className="size-3.5" />
          {triggerSummary(p.trigger)}
        </span>
        <span className="min-w-0 truncate">{KIND_META[p.blueprintKind].label}</span>
        <Link
          to={`/radar/processes/${p.id}/runs`}
          className="ml-auto shrink-0 underline-offset-2 hover:text-foreground hover:underline"
        >
          历史
        </Link>
      </div>

      {/* 进度条与状态并行（恒定一行，避免运行/待触发切换时卡片高度抖动）。
          运行中 = 任务完成度（实色）；待触发 = 倒计时进度（淡色）；已暂停 = 空轨道。 */}
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'shrink-0 text-xs font-medium',
            run ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {run ? '运行中' : p.status === 'active' ? '待触发' : '已暂停'}
        </span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              run ? 'bg-primary' : 'bg-primary/30',
            )}
            style={{ width: `${run ? pct : countdownPct}%` }}
          />
        </div>
        <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {run
            ? `${done}/${total} · ${pct}%`
            : p.status === 'active' && p.nextRunAt
              ? relFuture(p.nextRunAt * 1000, Date.now())
              : '—'}
        </span>
      </div>

      <ProcessFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        blueprints={blueprints}
        editing={p}
      />
      <ConfirmDelete
        open={delOpen}
        onOpenChange={setDelOpen}
        title="删除进程"
        description={`将删除进程「${p.label}」及其运行记录。图纸本身保留。`}
        onConfirm={() => del.mutate(String(p.id))}
      />
    </Card>
  );
}

function ControlRoom() {
  const q = useControlRoom();
  const bpq = useBlueprints();
  const [newProcOpen, setNewProcOpen] = useState(false);

  if (q.isError) {
    return (
      <>
        <PageHeader
          title="指挥室"
          description="这台情报雷达此刻在干什么——实时进程、出站请求、今日收成，一屏掌握并随手干预（趋势 / 成本 / 健康见数据看板）。"
        />
        <LoadError
          message={q.error instanceof ApiError ? q.error.message : undefined}
          onRetry={() => void q.refetch()}
        />
      </>
    );
  }
  if (q.isPending) {
    return (
      <>
        <PageHeader
          title="指挥室"
          description="这台情报雷达此刻在干什么——实时进程、出站请求、今日收成，一屏掌握并随手干预（趋势 / 成本 / 健康见数据看板）。"
        />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  const d = q.data;
  const blueprints = bpq.data ?? [];
  const dist = recheckBuckets(d.recheck.dist);
  const recheckTotal = d.recheck.dist.reduce((s, x) => s + x.count, 0);
  const recheckMax = Math.max(1, ...dist.map((x) => x.count));
  const alerts: RunDTO[] = d.alerts;

  return (
    <>
      <PageHeader
        title="指挥室"
        description="这台情报雷达此刻在干什么——实时进程、出站请求、今日收成，一屏掌握并随手干预（趋势 / 成本 / 健康见数据看板）。"
      />

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="今日新帖" value={d.today.posts} icon={Inbox} hint="采集任务完成数" />
          <Link to="/radar/insights" className="block transition-opacity hover:opacity-80">
            <StatCard
              label="今日洞察"
              value={d.today.insights}
              icon={Sparkles}
              hint="分析产出 · 去洞察库 →"
            />
          </Link>
          <StatCard
            label="在途任务"
            value={d.today.inflight}
            icon={Activity}
            hint="运行 + 排队 + 暂停"
          />
          {/* 复查健康卡见下方；新帖去掉跳转（浏览交工作区「帖子库」，单帖一生从上下文点入） */}
          <StatCard label="今日运行" value={d.today.runs} icon={Gauge} hint="各进程触发次数" />
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

        <Card className="gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
              <RefreshCw className="size-4 text-muted-foreground" /> 复查健康
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              sweep #{d.recheck.sweep} · 本轮到期 {d.recheck.dueNow}/{recheckTotal}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            活跃多查、沉默渐疏（指数退避 1→2→4→…→16 轮），一旦再活跃即复位。
          </p>
          <div className="mt-1 space-y-1.5">
            {dist.map((x) => (
              <div key={x.level} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-muted-foreground">{x.label}</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full', x.level === 0 ? 'bg-signal' : 'bg-primary')}
                    style={{ width: `${(x.count / recheckMax) * 100}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {x.count} 帖 · {x.interval}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">活跃进程</h2>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
                <Link to="/radar/blueprints">
                  <LayoutTemplate className="size-3.5" /> 图纸
                </Link>
              </Button>
              <Button
                size="sm"
                disabled={blueprints.length === 0}
                onClick={() => setNewProcOpen(true)}
              >
                <Plus className="size-3.5" /> 新建进程
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-3">
            {d.processes.map((p) => (
              <ProcessRow key={p.id} p={p} blueprints={blueprints} />
            ))}
          </div>
        </div>

        {alerts.length > 0 ? (
          <Card className="gap-2 border-destructive/30 p-4">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" /> 告警 · 最近失败运行
            </h2>
            <div className="space-y-1.5">
              {alerts.map((a) => (
                <Link
                  key={a.id}
                  to={`/radar/runs/${a.id}`}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">
                      {a.processLabel ?? a.blueprintLabel ?? `#${a.id}`}
                    </span>
                    <span className="text-muted-foreground"> · {a.error}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {a.finishedAt ? relPast(a.finishedAt * 1000, Date.now()) : ''}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      <ProcessFormDialog open={newProcOpen} onOpenChange={setNewProcOpen} blueprints={blueprints} />
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
