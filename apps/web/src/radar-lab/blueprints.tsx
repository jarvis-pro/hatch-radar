/**
 * 图纸管理（/radar/blueprints）—— 闭环的「定义」端。
 *
 * 左列图纸清单，右侧详情：标题 + 配方概要（源 / 参数）+ **执行流程**（主体）+ 进程。
 * 执行流程是一张**竖向阶段管道图**：按 blueprintFlow 铺开 发现→采集→分析→洞察 的完整链路，
 * 每阶段一条泳道、卡内是该阶段固定环节序列（标注成本 / 是否经请求闸 / 走哪个 lane），
 * 逐环节可挂/摘闸门（写 blueprint.gates 的复合键 kind:name，engine 据此让运行时任务停在该环节）。
 */
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronsUpDown,
  CornerDownRight,
  GitBranch,
  Globe,
  Languages,
  Lightbulb,
  MoreHorizontal,
  Pause,
  Pencil,
  Plus,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react';
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
import {
  blueprintFlow,
  gateKey,
  KIND_META,
  LANE_META,
  SOURCE_META,
  sourceToLane,
  type StageDef,
  STAGE_TEMPLATES,
  stageLabel,
  TASK_KIND_META,
  TRIGGER_META,
} from './constants';
import { ConfirmDelete } from './confirm-delete';
import { BlueprintFormDialog, ProcessFormDialog } from './forms';
import { deleteBlueprint, toggleBlueprintGate, toggleBlueprintStage, useWorld } from './store';
import type {
  Blueprint,
  CollectParams,
  LaneId,
  Process,
  RecheckParams,
  TaskKind,
  World,
} from './types';
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

// ─── 执行流程（竖向阶段管道） ───────────────────────────────────────────────────

/** 各阶段在图纸态的展示文案：扇出说明（头部右侧）+ 派生到下一阶段的说明（连接符）。 */
const PHASE_NOTE: Record<TaskKind, { fanout: string; spawn?: string }> = {
  discover: { fanout: '每轮发现 2~4 条新帖', spawn: '每条新帖派生一个采集任务' },
  collect: { fanout: '× 每条新帖', spawn: '每帖采集完派生一个分析任务' },
  recheck: { fanout: '× 每个到期旧帖', spawn: '有变化的帖派生一个分析任务' },
  analyze: { fanout: '产出洞察 · × 每帖' },
};

/** 图纸态下该环节经请求闸时走哪些 lane（source 类按图纸数据源推导，ai 类固定 ai）。 */
function stageLanes(def: StageDef, blueprint: Blueprint): LaneId[] {
  if (def.fetch === 'ai') return ['ai'];
  if (def.fetch === 'source')
    return [...new Set(blueprint.sources.map((s) => sourceToLane(s.kind)))];
  return [];
}

/** 单个环节小卡：名称 + 这步在做什么（联网抓取 / 调用 AI / 本地处理）+ 耗时 + 暂停点（整卡可点）。 */
function StageNode({
  blueprint,
  kind,
  def,
}: {
  blueprint: Blueprint;
  kind: TaskKind;
  def: StageDef;
}) {
  const key = gateKey(kind, def.name);

  // 可选环节（如翻译）：渲染成「启用 / 跳过」开关，而非暂停点。
  if (def.optional) {
    const enabled = blueprint.enabledStages?.includes(key) ?? false;
    return (
      <button
        type="button"
        onClick={() => toggleBlueprintStage(blueprint.id, key)}
        title={
          enabled
            ? '可选环节 · 已启用，点击跳过（运行时不再生成这一步）'
            : '可选环节 · 已跳过，点击启用（运行时才生成这一步、走 AI 翻译）'
        }
        className={cn(
          'flex w-48 flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-colors',
          enabled
            ? 'border-primary/50 bg-primary/5 hover:bg-primary/10'
            : 'border-dashed border-border bg-muted/20 hover:bg-muted/40',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-sm font-medium',
              enabled ? '' : 'text-muted-foreground',
            )}
          >
            <Languages className="size-3.5 shrink-0" />
            {stageLabel(def.name)}
          </span>
          {enabled ? (
            <ToggleRight className="size-4 shrink-0 text-primary" />
          ) : (
            <ToggleLeft className="size-4 shrink-0 text-muted-foreground/50" />
          )}
        </div>
        {enabled ? (
          <span className="inline-flex flex-wrap items-center gap-x-1 text-xs text-primary">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="size-3 shrink-0" /> 调用 AI 译为中文
            </span>
            <span className="text-muted-foreground">· 走 AI 闸</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/70">可选 · 默认跳过，点击启用</span>
        )}
      </button>
    );
  }

  const gated = blueprint.gates.includes(key);
  const lanes = stageLanes(def, blueprint);
  const isAi = def.fetch === 'ai';
  const isSource = def.fetch === 'source';
  return (
    <button
      type="button"
      onClick={() => toggleBlueprintGate(blueprint.id, key)}
      title={
        gated
          ? '已设暂停点 · 点击取消（运行时不再停在这一步）'
          : '点击设为暂停点：运行到这一步会停下、等你手动放行（用于逐步排查）'
      }
      className={cn(
        'flex min-w-[8.5rem] flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-colors',
        gated
          ? 'border-intensity-medium bg-intensity-medium/10'
          : 'border-border bg-card hover:bg-muted/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{stageLabel(def.name)}</span>
        {gated ? (
          <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-intensity-medium/20 px-1.5 text-[11px] font-medium text-intensity-medium">
            <Pause className="size-3" /> 暂停点
          </span>
        ) : null}
      </div>
      {isSource ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Globe className={cn('size-3 shrink-0', lanes[0] ? LANE_META[lanes[0]].color : '')} />
          联网抓取 · {lanes.map((l) => LANE_META[l].label).join(' / ')}
        </span>
      ) : isAi ? (
        <span className="inline-flex flex-wrap items-center gap-x-1 text-xs text-primary">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3 shrink-0" /> 调用 AI 模型
          </span>
          <span className="text-intensity-high">· 花钱、不可重算</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/80">本地处理</span>
      )}
    </button>
  );
}

/** 阶段间的派生连接符（↳ + 一句扇出说明）。 */
function FanoutConnector({ note }: { note: string }) {
  return (
    <div className="flex items-center gap-1.5 py-1.5 pl-4 text-xs text-muted-foreground">
      <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground/50" />
      <span>{note}</span>
    </div>
  );
}

/** 一条阶段泳道：序号 + 阶段名 + 扇出说明 + 该阶段环节序列（+ recheck 的分叉说明）。 */
function PhaseLane({
  blueprint,
  kind,
  index,
}: {
  blueprint: Blueprint;
  kind: TaskKind;
  index: number;
}) {
  const meta = TASK_KIND_META[kind];
  const stages = STAGE_TEMPLATES[kind];
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <meta.icon className={cn('size-4 shrink-0', meta.color)} />
        <span className="text-sm font-semibold">{meta.label}</span>
        <span className="font-mono text-[11px] text-muted-foreground/50">{kind}</span>
        <span className="ml-auto text-xs text-muted-foreground">{PHASE_NOTE[kind].fanout}</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-1.5">
        {stages.map((def, i) => (
          <Fragment key={def.name}>
            <StageNode blueprint={blueprint} kind={kind} def={def} />
            {i < stages.length - 1 ? (
              <ArrowRight className="size-3.5 shrink-0 self-center text-muted-foreground/40" />
            ) : null}
          </Fragment>
        ))}
      </div>
      {kind === 'recheck' ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <GitBranch className="mt-0.5 size-3 shrink-0 text-intensity-medium" />
          <span>
            <span className="font-medium text-foreground">比对变化后分叉</span>：未变 →
            指数退避、跳过本帖；有变 → 继续重抓评论 + 落库 + 派生分析。
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** 执行流程主体：blueprintFlow 阶段链逐条泳道 + 派生连接 + 洞察终点。 */
function StageFlow({ blueprint }: { blueprint: Blueprint }) {
  const flow = blueprintFlow(blueprint.kind);
  return (
    <div>
      {flow.map((kind, i) => (
        <Fragment key={kind}>
          <PhaseLane blueprint={blueprint} kind={kind} index={i} />
          <FanoutConnector
            note={
              i < flow.length - 1
                ? (PHASE_NOTE[kind].spawn ?? '')
                : '分析产出洞察 · 按 post_id 幂等落库'
            }
          />
        </Fragment>
      ))}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-signal/40 bg-signal/5 px-3 py-2.5">
        <Lightbulb className="size-4 shrink-0 text-signal" />
        <span className="text-sm font-medium">洞察入库</span>
        <span className="ml-auto text-xs text-muted-foreground">进收成研判台 · 痛点 / 机会</span>
      </div>
    </div>
  );
}

// ─── 图纸详情 ──────────────────────────────────────────────────────────────────

/** 标题处的图纸切换下拉：列出所有图纸（带进程数 / 当前勾选）+ 新建入口。 */
function BlueprintSwitcher({
  blueprints,
  selected,
  procByBp,
  onSelect,
  onNew,
}: {
  blueprints: Blueprint[];
  selected: Blueprint;
  procByBp: { id: string; processes: Process[] }[];
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const km = KIND_META[selected.kind];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="-mx-2 flex max-w-full items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/50"
        >
          <km.icon className="size-4 shrink-0 text-primary" />
          <span className="truncate text-lg font-semibold">{selected.label}</span>
          <Badge variant="outline" className="shrink-0">
            {km.label}
          </Badge>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {blueprints.map((b) => {
          const m = KIND_META[b.kind];
          const count = procByBp.find((x) => x.id === b.id)?.processes.length ?? 0;
          const active = b.id === selected.id;
          return (
            <DropdownMenuItem key={b.id} onClick={() => onSelect(b.id)} className="gap-2">
              <m.icon
                className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
              />
              <span className="min-w-0 flex-1 truncate">{b.label}</span>
              {active ? <Check className="size-4 shrink-0 text-primary" /> : null}
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {count}
              </Badge>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNew}>
          <Plus className="size-4" /> 新建图纸
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BlueprintDetail({
  blueprint,
  processes,
  blueprints,
  procByBp,
  onSelect,
  onNew,
}: {
  blueprint: Blueprint;
  processes: Process[];
  blueprints: Blueprint[];
  procByBp: { id: string; processes: Process[] }[];
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [newProcOpen, setNewProcOpen] = useState(false);
  const km = KIND_META[blueprint.kind];
  const flowLen = blueprintFlow(blueprint.kind).length;

  return (
    <Card className="gap-5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <BlueprintSwitcher
            blueprints={blueprints}
            selected={blueprint}
            procByBp={procByBp}
            onSelect={onSelect}
            onNew={onNew}
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-0.5 text-xs text-muted-foreground">
            <span>{km.blurb}</span>
            {blueprint.note ? <span>· {blueprint.note}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setNewProcOpen(true)}>
            <Plus className="size-3.5" /> 新建进程
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label="图纸操作"
              >
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

      {/* 配方概要：源 + 参数 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">数据源</div>
          <div className="flex flex-wrap gap-2">
            {blueprint.sources.map((s) => {
              const m = SOURCE_META[s.kind];
              return (
                <span
                  key={s.kind}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
                >
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
      </div>

      {/* 执行流程：详情卡主体 */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-sm font-semibold">执行流程</h3>
          <span className="text-xs text-muted-foreground">
            跑起来会经历 {flowLen}{' '}
            个阶段。点普通环节设「暂停点」（运行到那步停下等放行）；点虚线的「可选环节」可启用 /
            跳过（如翻译，默认跳过）。
          </span>
        </div>
        <StageFlow blueprint={blueprint} />
      </div>

      {/* 进程 */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">进程（{processes.length}）</div>
        {processes.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">
            还没有进程——点「新建进程」给它挂个节奏。
          </p>
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
                <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground/70 sm:inline">
                  已跑 {p.runsTotal}
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
      ) : selected ? (
        <BlueprintDetail
          key={selected.id}
          blueprint={selected}
          processes={procs}
          blueprints={blueprints}
          procByBp={procByBp}
          onSelect={setSelectedId}
          onNew={() => setNewOpen(true)}
        />
      ) : null}

      <BlueprintFormDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => setSelectedId(id)}
      />
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
