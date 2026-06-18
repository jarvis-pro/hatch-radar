import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { timeAgo } from '@/lib/format';

/** 进程行（投影自后端 /pipeline/runs） */
export interface RunView {
  id: number;
  kind: string;
  status: string;
  triggerSource: string;
  sweepSeq: number | null;
  blueprintLabel: string | null;
  tasksTotal: number;
  tasksDone: number;
  tasksSkipped: number;
  tasksFailed: number;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

const RUN_STATUS_META: Record<string, { label: string; variant: Variant }> = {
  running: { label: '运行中', variant: 'default' },
  paused: { label: '暂停', variant: 'outline' },
  completed: { label: '完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '已取消', variant: 'outline' },
};

/** 任务类型中文标签（图纸 kind 复用） */
export const KIND_LABEL: Record<string, string> = {
  analyze: '分析',
  collect: '采集',
  recheck: '复查',
  discover: '发现',
  translate: '翻译',
  maintenance: '维护',
};

export function runStatusMeta(s: string): { label: string; variant: Variant } {
  return RUN_STATUS_META[s] ?? { label: s, variant: 'outline' };
}
export function kindLabel(k: string): string {
  return KIND_LABEL[k] ?? k;
}

function PipelineView() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['pipeline-runs'],
    queryFn: () => api.get<{ runs: RunView[] }>('/pipeline/runs'),
    refetchInterval: 3000,
  });
  const runs = q.data?.runs ?? [];

  return (
    <>
      <PageHeader
        title="进程"
        description="图纸触发产生的进程与其派生的任务 · 每 3 秒刷新 · 点击任意行查看任务树"
      />

      {q.isError ? (
        <LoadError
          message={q.error instanceof ApiError ? q.error.message : undefined}
          onRetry={() => void q.refetch()}
        />
      ) : q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : runs.length === 0 ? (
        <EmptyState
          title="暂无进程"
          hint="配置 active 模型后，分析调度会派生进程；采集 / 复查图纸触发后亦会在此出现。"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">类型</TableHead>
                <TableHead className="w-20">状态</TableHead>
                <TableHead>图纸</TableHead>
                <TableHead className="w-44">任务</TableHead>
                <TableHead className="w-16">来源</TableHead>
                <TableHead className="w-32">时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => {
                const meta = runStatusMeta(r.status);
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/pipeline/${r.id}`)}
                  >
                    <TableCell className="text-xs text-muted-foreground">
                      {kindLabel(r.kind)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{r.blueprintLabel ?? `#${r.id}`}</TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {r.tasksDone}/{r.tasksTotal} 完成
                      {r.tasksSkipped > 0 ? ` · ${r.tasksSkipped} 略过` : ''}
                      {r.tasksFailed > 0 ? (
                        <span className="text-destructive"> · {r.tasksFailed} 失败</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.triggerSource === 'manual' ? '手动' : r.triggerSource === 'cron' ? '定时' : r.triggerSource}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {timeAgo(r.finishedAt ?? r.startedAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

/** 进程总览页（analyze:run）：图纸触发的进程列表，点击进任务树。 */
export function PipelinePage() {
  return (
    <RequirePerm perm="analyze:run">
      <PipelineView />
    </RequirePerm>
  );
}
