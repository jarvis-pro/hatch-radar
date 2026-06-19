/**
 * 进程管理页（原型，mock 数据）：独立于「图纸」页，统一列出并管理所有进程。
 * 进程 = 某图纸 + 一套节奏（单次/间隔/定时）+ 启停；同一图纸可有多个不同节奏的进程。
 * 运行记录独立成页（[process-runs.tsx](./process-runs)）；列表项尽量克制高度——全部行为收进右上 ⋯ 菜单。
 * 刻意不碰既有 /pipeline·/requests（已实现的检视器）。
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutTemplate,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  ScrollText,
  Trash2,
  Zap,
} from 'lucide-react';
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
import { toast } from '@hatch-radar/ui/components/sonner';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { ConfirmDelete } from './confirm-delete';
import { KIND_META, PROCESS_STATUS_META, TRIGGER_META } from './constants';
import { ProcessFormDialog } from './forms';
import { mockApi } from './mock';
import type { Blueprint, Process, ProcessStatus } from './types';
import { KEYS, relTime, triggerSummary } from './util';

/** 状态点颜色（标题前的状态指示；色彩约定可调）。 */
const STATUS_DOT: Record<ProcessStatus, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  completed: 'bg-muted-foreground',
};

/** 指标格：标签（灰）+ 值（实）；靠竖分割线彼此区隔（无外框，轻量）。 */
function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 px-3 first:pl-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium tabular-nums">{children}</div>
    </div>
  );
}

// ─── 进程卡片（紧凑：名称/状态/⋯ 一行 · 节奏 + 图纸一行 · 指标一行） ─────────────────

function ProcessCard({ process, blueprints }: { process: Process; blueprints: Blueprint[] }) {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const blueprint = blueprints.find((b) => b.id === process.blueprintId);
  const isRecheck = blueprint?.kind === 'recheck';
  const meta = PROCESS_STATUS_META[process.status];
  const TriggerIcon = TRIGGER_META[process.trigger.kind].icon;
  const active = process.status === 'active';
  const nextLabel =
    active && process.nextRunAt
      ? relTime(process.nextRunAt)
      : process.trigger.kind === 'once'
        ? '待手动'
        : '—';

  async function refresh(): Promise<void> {
    await Promise.all([
      qc.invalidateQueries({ queryKey: KEYS.allProcesses }),
      qc.invalidateQueries({ queryKey: KEYS.runs(process.id) }),
      qc.invalidateQueries({ queryKey: KEYS.runStats(process.id) }),
      qc.invalidateQueries({ queryKey: KEYS.counts }),
    ]);
  }

  async function toggleStatus(): Promise<void> {
    setBusy(true);
    try {
      await mockApi.setProcessStatus(process.id, active ? 'paused' : 'active');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function trigger(): Promise<void> {
    setBusy(true);
    try {
      await mockApi.triggerNow(process.id);
      toast.success('已触发一次运行');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`size-2 shrink-0 rounded-full ${STATUS_DOT[process.status]}`}
            title={meta.label}
            aria-label={meta.label}
          />
          <span className="truncate font-medium">{process.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="-mr-1.5 text-muted-foreground"
                disabled={busy}
                aria-label="操作"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void toggleStatus()}>
                {active ? (
                  <>
                    <Pause /> 暂停调度
                  </>
                ) : (
                  <>
                    <Play /> 恢复调度
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void trigger()}>
                <Zap /> 立即触发
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/processes/${process.id}/runs`}>
                  <ScrollText /> 运行记录
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil /> 编辑节奏
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDelOpen(true)}>
                <Trash2 /> 删除进程
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-x-5 text-sm font-medium">
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <TriggerIcon className="size-4 shrink-0 text-muted-foreground" />
          {triggerSummary(process.trigger)}
        </span>
        {blueprint ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <LayoutTemplate className="size-3.5 shrink-0 text-muted-foreground" aria-label="图纸" />
            <span className="truncate">
              {KIND_META[blueprint.kind].label} · {blueprint.label}
            </span>
          </span>
        ) : (
          <span className="shrink-0 font-normal text-destructive">图纸已删除</span>
        )}
      </div>

      <div className="flex divide-x">
        <Metric label="下次触发">{nextLabel}</Metric>
        <Metric label="上次运行">{process.lastRunAt ? relTime(process.lastRunAt) : '从未'}</Metric>
        <Metric label="累计">{process.runsTotal}</Metric>
        {isRecheck ? <Metric label="sweep">{process.sweepSeq}</Metric> : null}
      </div>

      <ProcessFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        blueprints={blueprints}
        editing={process}
      />
      <ConfirmDelete
        open={delOpen}
        onOpenChange={setDelOpen}
        title="删除进程"
        description={`将删除进程「${process.label}」及其运行记录。图纸本身保留。`}
        onConfirm={async () => {
          await mockApi.deleteProcess(process.id);
          toast.success('进程已删除');
          await refresh();
        }}
      />
    </Card>
  );
}

// ─── 页面 ─────────────────────────────────────────────────────────────────────

function ProcessLab() {
  const [newOpen, setNewOpen] = useState(false);
  const procQ = useQuery({
    queryKey: KEYS.allProcesses,
    queryFn: () => mockApi.listAllProcesses(),
  });
  const bpQ = useQuery({ queryKey: KEYS.blueprints, queryFn: () => mockApi.listBlueprints() });
  const processes = procQ.data ?? [];
  const blueprints = bpQ.data ?? [];
  const noBlueprints = !bpQ.isPending && blueprints.length === 0;

  return (
    <>
      <PageHeader
        title="进程"
        description="基于图纸创建的运行进程：每个进程一套节奏，行为收进右上 ⋯ 菜单。"
        actions={
          <Button size="sm" disabled={noBlueprints} onClick={() => setNewOpen(true)}>
            <Plus className="size-3.5" /> 新建进程
          </Button>
        }
      />

      {procQ.isError ? (
        <LoadError onRetry={() => void procQ.refetch()} />
      ) : procQ.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : noBlueprints ? (
        <EmptyState
          title="还没有图纸"
          hint="进程需要基于图纸创建。先去「图纸」页建一张，再回来挂节奏。"
          action={
            <Button size="sm" asChild>
              <Link to="/blueprints">
                <Plus className="size-3.5" /> 去新建图纸
              </Link>
            </Button>
          }
        />
      ) : processes.length === 0 ? (
        <EmptyState
          title="还没有进程"
          hint="点「新建进程」：选一张图纸、设定运行节奏（单次 / 间隔 / 定时）。"
          action={
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="size-3.5" /> 新建进程
            </Button>
          }
        />
      ) : (
        // 自适应网格：每张卡片至少 26rem 宽，宽度够就一行多张（min(…,100%) 防移动端溢出）。
        // 想更宽 / 更窄，调这个 26rem 即可。
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] gap-4">
          {processes.map((p) => (
            <ProcessCard key={p.id} process={p} blueprints={blueprints} />
          ))}
        </div>
      )}

      <ProcessFormDialog open={newOpen} onOpenChange={setNewOpen} blueprints={blueprints} />
    </>
  );
}

/** 进程管理页（原型）。沿用 analyze:run 能力，避免为 mock 引入新权限。 */
export function ProcessesPage() {
  return (
    <RequirePerm perm="analyze:run">
      <ProcessLab />
    </RequirePerm>
  );
}
