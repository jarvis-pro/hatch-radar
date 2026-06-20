/**
 * 图纸管理（/radar/blueprints）—— 闭环的「定义」端。
 *
 * 左列图纸清单，右侧详情：源 / 参数 + **该 kind 固定环节模板的有序条带**，逐环节挂/摘闸门
 * （写 blueprint.gates，engine 已据此让运行时任务停在该环节——收敛到可执行、所见即所跑）。
 * 底部列该图纸的进程，可直接新建进程给它挂节奏。
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, LockOpen, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Card } from '@hatch-radar/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hatch-radar/ui/components/dropdown-menu';
import { toast } from '@hatch-radar/ui/components/sonner';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { KIND_META, SOURCE_META, STAGE_TEMPLATES, stageLabel, TRIGGER_META } from './constants';
import { ConfirmDelete } from './confirm-delete';
import { BlueprintFormDialog, ProcessFormDialog } from './forms';
import { deleteBlueprint, toggleBlueprintGate, useWorld } from './store';
import type { Blueprint, CollectParams, Process, RecheckParams, World } from './types';
import { triggerSummary } from './util';

function selectBlueprints(w: World) {
  return {
    blueprints: w.blueprints,
    procByBp: w.blueprints.map((b) => ({
      id: b.id,
      processes: w.processes.filter((p) => p.blueprintId === b.id),
    })),
  };
}

function paramChips(b: Blueprint): { label: string; value: number }[] {
  if (b.kind === 'collect') {
    const p = b.params as CollectParams;
    return [
      { label: '翻页上限', value: p.limit },
      { label: '连续命中即停', value: p.stopAfterKnown },
      { label: '评论预算', value: p.commentBudget },
    ];
  }
  const p = b.params as RecheckParams;
  return [
    { label: '每批帖数', value: p.batchSize },
    { label: '批间冷却(s)', value: p.batchIntervalSec },
    { label: '退避封顶', value: p.backoffCap },
  ];
}

// ─── 环节流程条带（挂闸） ───────────────────────────────────────────────────────

function StageStrip({ blueprint }: { blueprint: Blueprint }) {
  const stages = STAGE_TEMPLATES[blueprint.kind];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {stages.map((st, i) => {
        const gated = blueprint.gates.includes(st.name);
        return (
          <div key={st.name} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggleBlueprintGate(blueprint.id, st.name)}
              title={gated ? '点击摘闸门' : '点击挂闸门（运行时任务跑到此处停、等放行）'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                gated
                  ? 'border-intensity-medium/60 bg-intensity-medium/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/50',
              )}
            >
              {gated ? (
                <Lock className="size-3 text-intensity-medium" />
              ) : (
                <LockOpen className="size-3 opacity-50" />
              )}
              {stageLabel(st.name)}
            </button>
            {i < stages.length - 1 ? <ArrowRight className="size-3 shrink-0 text-muted-foreground/40" /> : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── 图纸详情 ──────────────────────────────────────────────────────────────────

function BlueprintDetail({
  blueprint,
  processes,
}: {
  blueprint: Blueprint;
  processes: Process[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [newProcOpen, setNewProcOpen] = useState(false);
  const km = KIND_META[blueprint.kind];

  return (
    <Card className="gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <km.icon className="size-4 text-primary" />
            <span className="text-lg font-semibold">{blueprint.label}</span>
            <Badge variant="outline">{km.label}</Badge>
          </div>
          {blueprint.note ? <p className="text-sm text-muted-foreground">{blueprint.note}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setNewProcOpen(true)}>
            <Plus className="size-3.5" /> 新建进程
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label="图纸操作">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" /> 编辑图纸
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDelOpen(true)}>
                <Trash2 className="size-4" /> 删除图纸
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">数据源</div>
        <div className="flex flex-wrap gap-2">
          {blueprint.sources.map((s) => {
            const m = SOURCE_META[s.kind];
            return (
              <span key={s.kind} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs">
                <m.icon className="size-3.5 text-muted-foreground" />
                <span className="font-medium">{m.label}</span>
                <span className="text-muted-foreground">{s.channels.join(' · ')}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">参数</div>
        <div className="flex flex-wrap gap-2">
          {paramChips(blueprint).map((p) => (
            <span key={p.label} className="rounded-md bg-muted px-2.5 py-1 text-xs">
              {p.label} <span className="font-medium tabular-nums">{p.value}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          执行流程（点环节挂/摘闸门 —— 运行时任务跑到挂闸环节即停、等放行）
        </div>
        <StageStrip blueprint={blueprint} />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">进程（{processes.length}）</div>
        {processes.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">还没有进程——点「新建进程」给它挂个节奏。</p>
        ) : (
          <div className="divide-y rounded-md border">
            {processes.map((p) => (
              <Link
                key={p.id}
                to={`/radar/processes/${p.id}/runs`}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    p.status === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/50',
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{p.label}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {(() => {
                    const Icon = TRIGGER_META[p.trigger.kind].icon;
                    return <Icon className="size-3.5" />;
                  })()}
                  {triggerSummary(p.trigger)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <BlueprintFormDialog open={editOpen} onOpenChange={setEditOpen} editing={blueprint} />
      <ProcessFormDialog
        open={newProcOpen}
        onOpenChange={setNewProcOpen}
        blueprints={[blueprint]}
      />
      <ConfirmDelete
        open={delOpen}
        onOpenChange={setDelOpen}
        title="删除图纸"
        description={`将删除图纸「${blueprint.label}」及其全部进程与运行记录。此操作不可撤销。`}
        onConfirm={() => {
          deleteBlueprint(blueprint.id);
          toast.success('图纸已删除');
        }}
      />
    </Card>
  );
}

// ─── 页面 ──────────────────────────────────────────────────────────────────────

function BlueprintsView() {
  const { blueprints, procByBp } = useWorld(selectBlueprints);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const selected = blueprints.find((b) => b.id === selectedId) ?? blueprints[0] ?? null;
  const procs = selected ? (procByBp.find((x) => x.id === selected.id)?.processes ?? []) : [];

  return (
    <>
      <PageHeader
        title="图纸"
        description="图纸 = 配方（抓哪些源 · 采集/复查 · 参数 · 挂闸的环节），不含节奏。节奏在进程上设。"
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="size-3.5" /> 新建图纸
          </Button>
        }
      />

      {blueprints.length === 0 ? (
        <EmptyState title="还没有图纸" hint="新建第一张图纸——定义要抓哪些源、做采集还是复查。" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-1.5">
            {blueprints.map((b) => {
              const count = procByBp.find((x) => x.id === b.id)?.processes.length ?? 0;
              const active = selected?.id === b.id;
              const km = KIND_META[b.kind];
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg border p-3 text-left transition-colors',
                    active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <km.icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.label}</span>
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {count}
                  </Badge>
                </button>
              );
            })}
          </div>
          {selected ? <BlueprintDetail key={selected.id} blueprint={selected} processes={procs} /> : null}
        </div>
      )}

      <BlueprintFormDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => setSelectedId(id)} />
    </>
  );
}

export function BlueprintsPage() {
  return (
    <RequirePerm perm="analyze:run">
      <BlueprintsView />
    </RequirePerm>
  );
}
