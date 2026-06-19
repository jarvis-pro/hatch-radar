/**
 * 图纸实验室（原型，mock 数据）：管理「图纸（配方）」—— 抓哪些源、采集还是复查、各项参数。
 * 进程（运行节奏）已独立到「进程」页（[processes.tsx](./processes)）管理，此页只管配方。
 *
 * 自包含：仅本目录文件 + 通用外壳组件（PageHeader / Empty / RequirePerm）+ @hatch-radar/ui。
 * 刻意不碰既有 /pipeline·/requests 页面（那是已实现的检视器）。
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hatch-radar/ui/components/dropdown-menu';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Card, CardContent } from '@hatch-radar/ui/components/card';
import { Separator } from '@hatch-radar/ui/components/separator';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { toast } from '@hatch-radar/ui/components/sonner';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { BlueprintPicker } from './blueprint-picker';
import { ConfirmDelete } from './confirm-delete';
import { SOURCE_META } from './constants';
import { InlineFlowEditor } from './flow-editor';
import { BlueprintFormDialog } from './forms';
import { mockApi } from './mock';
import type { Blueprint, CollectParams, RecheckParams } from './types';
import { KEYS } from './util';

// ─── 图纸详情（右栏） ──────────────────────────────────────────────────────────

function ParamChips({ blueprint }: { blueprint: Blueprint }) {
  const chips: string[] = [];
  if (blueprint.kind === 'collect') {
    const p = blueprint.params as CollectParams;
    chips.push(
      `翻页上限 ${p.limit}`,
      `连命中 ${p.stopAfterKnown} 停`,
      `评论预算 ${p.commentBudget}`,
    );
  } else {
    const p = blueprint.params as RecheckParams;
    chips.push(`每批 ${p.batchSize}`, `冷却 ${p.batchIntervalSec}s`, `退避封顶 ${p.backoffCap}`);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Badge key={c} variant="outline" className="font-normal text-muted-foreground">
          {c}
        </Badge>
      ))}
    </div>
  );
}

function BlueprintDetail({
  blueprint,
  blueprints,
  counts,
  onSelect,
}: {
  blueprint: Blueprint;
  blueprints: Blueprint[];
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <BlueprintPicker
          blueprints={blueprints}
          counts={counts}
          selectedId={blueprint.id}
          onSelect={onSelect}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 text-muted-foreground"
              aria-label="图纸操作"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              编辑图纸
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDelOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" />
              删除图纸
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">数据源</div>
            <div className="flex flex-wrap gap-1.5">
              {blueprint.sources.map((s) => {
                const Icon = SOURCE_META[s.kind].icon;
                return (
                  <Badge key={s.kind} variant="outline" className="gap-1 font-normal">
                    <Icon className="size-3" />
                    {SOURCE_META[s.kind].label}
                    {s.channels.length > 0 ? `：${s.channels.join('、')}` : ''}
                  </Badge>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">参数</div>
            <ParamChips blueprint={blueprint} />
          </div>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium text-muted-foreground">执行流程</div>
              <span className="text-xs text-muted-foreground/70">· 拖拽编辑 · 改动自动保存</span>
            </div>
            <InlineFlowEditor blueprint={blueprint} />
          </div>
        </CardContent>
      </Card>

      <BlueprintFormDialog open={editOpen} onOpenChange={setEditOpen} editing={blueprint} />
      <ConfirmDelete
        open={delOpen}
        onOpenChange={setDelOpen}
        title="删除图纸"
        description={`将删除图纸「${blueprint.label}」及其全部进程与运行记录。此操作不可撤销。`}
        onConfirm={async () => {
          await mockApi.deleteBlueprint(blueprint.id);
          toast.success('图纸已删除');
          await Promise.all([
            qc.invalidateQueries({ queryKey: KEYS.blueprints }),
            qc.invalidateQueries({ queryKey: KEYS.counts }),
            qc.invalidateQueries({ queryKey: KEYS.allProcesses }),
          ]);
        }}
      />
    </div>
  );
}

// ─── 图纸列表（左栏） ──────────────────────────────────────────────────────────

// ─── 页面 ─────────────────────────────────────────────────────────────────────

function BlueprintLab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newBpOpen, setNewBpOpen] = useState(false);

  const bpQ = useQuery({ queryKey: KEYS.blueprints, queryFn: () => mockApi.listBlueprints() });
  const countQ = useQuery({ queryKey: KEYS.counts, queryFn: () => mockApi.processCounts() });
  const blueprints = bpQ.data ?? [];

  // 选中项在渲染期求值、兜底首项（未选 / 选中已删 → 落首项）。不用 effect 回写，避免与新建后
  // setSelectedId(新 id) 抢状态、在列表刷新到位前被拉回首项。
  const selected = blueprints.find((b) => b.id === selectedId) ?? blueprints[0] ?? null;

  return (
    <>
      <PageHeader
        title="图纸"
        description="图纸 = 配方（抓哪些源 · 采集/复查 · 参数），不含节奏。运行节奏在「进程」页设。"
        actions={
          <Button size="sm" onClick={() => setNewBpOpen(true)}>
            <Plus className="size-3.5" /> 新建图纸
          </Button>
        }
      />

      {bpQ.isError ? (
        <LoadError onRetry={() => void bpQ.refetch()} />
      ) : bpQ.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : blueprints.length === 0 ? (
        <EmptyState title="还没有图纸" hint="新建第一张图纸 —— 定义要抓哪些源、做采集还是复查。" />
      ) : selected ? (
        <BlueprintDetail
          key={selected.id}
          blueprint={selected}
          blueprints={blueprints}
          counts={countQ.data ?? {}}
          onSelect={setSelectedId}
        />
      ) : null}

      <BlueprintFormDialog
        open={newBpOpen}
        onOpenChange={setNewBpOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </>
  );
}

/** 图纸实验室页（原型）。沿用 analyze:run 能力，避免为 mock 引入新权限。 */
export function BlueprintLabPage() {
  return (
    <RequirePerm perm="analyze:run">
      <BlueprintLab />
    </RequirePerm>
  );
}
