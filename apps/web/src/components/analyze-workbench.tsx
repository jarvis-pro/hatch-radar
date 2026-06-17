import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { ButtonGroup } from '@hatch-radar/ui/components/button-group';
import { Checkbox } from '@hatch-radar/ui/components/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { toast } from '@hatch-radar/ui/components/sonner';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';
import { timeAgo } from '@/lib/format';

/** 工作台单条待分析帖子（含热度信息，便于判断是否值得分析） */
export interface WorkbenchItem {
  id: string;
  title: string;
  channel: string;
  /** pending=未分析；restale=已分析但评论又变（建议重判） */
  kind: 'pending' | 'restale';
  score: number;
  numComments: number;
  createdUtc: number;
}

/** 可选模型（启用的模型配置投影） */
export interface ProviderOption {
  id: number;
  label: string;
}

/**
 * 分析工作台：待分析帖子表格（行级勾选 + 表头全选）+ 选模型运行。
 * 运行方式两种：① 表头组合控件「选模型 + 运行选中」批量入队；② 每行「运行」按钮单条入队。
 * 已入队帖子由后端从列表排除——入队后该行消失即为反馈（不再弹无意义的入队提示）。
 * 队列进度在顶部导航「队列」红点 + /queue 页查看，本页不再重复展示。
 */
export function AnalyzeWorkbench({
  items,
  providers,
  defaultProviderId,
  providersError,
  total,
  pagination,
}: {
  items: WorkbenchItem[];
  providers: ProviderOption[];
  defaultProviderId: number | null;
  providersError: string | null;
  total: number;
  pagination: ReactNode;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [providerId, setProviderId] = useState<string>(
    defaultProviderId != null && providers.some((p) => p.id === defaultProviderId)
      ? String(defaultProviderId)
      : providers.length > 0
        ? String(providers[0].id)
        : '',
  );
  const [batchBusy, setBatchBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
    );
  }

  /** 入队（批量 / 单条共用）：成功后刷新待分析列表与导航队列红点 */
  async function enqueue(ids: string[]): Promise<void> {
    await api.post('/analysis/run', { postIds: ids, providerId: Number(providerId) });
    qc.invalidateQueries({ queryKey: ['awaiting'] });
    qc.invalidateQueries({ queryKey: ['queue-inflight'] });
  }

  async function runSelected() {
    const ids = [...selected];
    if (ids.length === 0 || !providerId) return;
    setBatchBusy(true);
    try {
      await enqueue(ids);
      setSelected(new Set());
      toast.success(`已入队 ${ids.length} 篇 → 队列`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '运行失败');
    } finally {
      setBatchBusy(false);
    }
  }

  async function runOne(id: string) {
    if (!providerId) return;
    setRunningId(id);
    try {
      await enqueue([id]);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success('已入队 1 篇 → 队列');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '运行失败');
    } finally {
      setRunningId(null);
    }
  }

  const noModels = providers.length === 0;
  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0 && !allSelected;
  const runDisabled = !providerId || batchBusy;

  return (
    <div className="space-y-3">
      {noModels ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {providersError ?? '未配置可用模型。'}请到{' '}
          <Link to="/settings" className="underline">
            设置页
          </Link>{' '}
          添加并启用一个模型后再运行。
        </div>
      ) : null}

      <div className="rounded-lg border">
        {/* 表头工具栏：计数 + 组合控件（选模型 | 运行选中） */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2.5">
          <span className="text-sm font-medium">
            待分析 <span className="tabular-nums text-muted-foreground">{total}</span>
            {selected.size > 0 ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                已选 {selected.size}
              </span>
            ) : null}
          </span>
          {!noModels ? (
            <ButtonGroup>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger className="min-w-40" aria-label="选择模型">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={runSelected} disabled={selected.size === 0 || runDisabled}>
                {batchBusy ? '运行中…' : '运行选中'}
              </Button>
            </ButtonGroup>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            暂无待分析帖子。server 抓取并补全评论后，这里会列出待分析与建议重判的帖子。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={() => toggleAll()}
                      aria-label="全选本页"
                    />
                  </TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead className="hidden w-36 sm:table-cell">频道</TableHead>
                  <TableHead className="w-16 text-right">赞</TableHead>
                  <TableHead className="w-16 text-right">评论</TableHead>
                  <TableHead className="hidden w-24 md:table-cell">发布</TableHead>
                  <TableHead className="w-20 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const isSel = selected.has(it.id);
                  return (
                    <TableRow
                      key={it.id}
                      data-state={isSel ? 'selected' : undefined}
                      className="cursor-pointer"
                      onClick={() => toggle(it.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSel}
                          onCheckedChange={() => toggle(it.id)}
                          aria-label="选择此帖以运行分析"
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="line-clamp-2">{it.title}</span>
                        {it.kind === 'restale' ? (
                          <Badge variant="secondary" className="mt-1">
                            评论已更新 · 建议重判
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {it.channel}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {it.score}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {it.numComments}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                        {timeAgo(it.createdUtc)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={runDisabled || runningId === it.id}
                          onClick={() => runOne(it.id)}
                        >
                          {runningId === it.id ? <Spinner /> : '运行'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {pagination}
    </div>
  );
}
