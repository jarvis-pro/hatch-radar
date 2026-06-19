import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { InspectStepView } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { toast } from '@hatch-radar/ui/components/sonner';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { FlowDiagram } from '@/components/pipeline/flow-diagram';
import { RunGraph, type GraphTask } from '@/components/pipeline/run-graph';
import { timeAgo } from '@/lib/format';
import { kindLabel, runStatusMeta, type RunView } from '@/pages/pipeline';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

interface StageView {
  seq: number;
  name: string;
  status: string;
  gate: boolean;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

interface TaskView extends GraphTask {
  attempts: number;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stages: StageView[];
}

interface RunDetail {
  run: RunView;
  tasks: TaskView[];
}

const TASK_STATUS_META: Record<string, { label: string; variant: Variant }> = {
  queued: { label: '排队', variant: 'outline' },
  running: { label: '运行中', variant: 'default' },
  paused: { label: '暂停', variant: 'outline' },
  succeeded: { label: '成功', variant: 'secondary' },
  skipped: { label: '略过', variant: 'outline' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '已取消', variant: 'outline' },
};

const ACTIVE = new Set(['queued', 'running', 'paused']);

/** 选中焦点优先级：暂停 > 失败 > 运行中 > 第一个（开页 / 轮询后默认聚焦最需关注的任务）。 */
function focusTask(tasks: TaskView[], pickedId: number | null): TaskView | null {
  if (pickedId != null) {
    const hit = tasks.find((t) => t.id === pickedId);
    if (hit) return hit;
  }
  return (
    tasks.find((t) => t.status === 'paused') ??
    tasks.find((t) => t.status === 'failed') ??
    tasks.find((t) => t.status === 'running') ??
    tasks[0] ??
    null
  );
}

/** StageView → FlowDiagram 所需的 InspectStepView（无产物，置空；图只用状态/耗时）。 */
function toSteps(stages: StageView[]): InspectStepView[] {
  return stages.map((s) => ({
    seq: s.seq,
    name: s.name,
    status: s.status,
    inputSummary: null,
    output: null,
    error: s.error,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
  }));
}

/** 当前环节 seq（运行中 > 失败 > 最近完成 > 第一个）。 */
function currentSeq(steps: InspectStepView[]): number {
  return (
    steps.find((s) => s.status === 'running')?.seq ??
    steps.find((s) => s.status === 'failed')?.seq ??
    [...steps].reverse().find((s) => s.status === 'done')?.seq ??
    steps[0]?.seq ??
    0
  );
}

/** 选中任务面板：元信息 + 环节流程图 + 闸门控制条。 */
function TaskPanel({ task, onAct, busy }: { task: TaskView; onAct: Act; busy: boolean }) {
  const meta = TASK_STATUS_META[task.status] ?? { label: task.status, variant: 'outline' as const };
  const steps = toSteps(task.stages);
  const isAnalyze = task.kind === 'analyze';
  return (
    <div className="mt-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={meta.variant}>{meta.label}</Badge>
        <span className="text-sm font-medium">
          {kindLabel(task.kind)} · 任务 #{task.id}
        </span>
        {task.postId ? (
          <Link to={`/posts/${task.postId}`} className="font-mono text-xs hover:underline">
            {task.postId}
          </Link>
        ) : null}
        {task.model ? (
          <span className="font-mono text-xs text-muted-foreground">{task.model}</span>
        ) : null}
        {task.inputTokens != null ? (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            in {task.inputTokens.toLocaleString()} · out {(task.outputTokens ?? 0).toLocaleString()}
          </span>
        ) : null}
      </div>

      {steps.length > 0 ? (
        <div className="mt-3">
          <FlowDiagram steps={steps} selectedSeq={currentSeq(steps)} onSelect={() => {}} />
        </div>
      ) : null}

      {task.error ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
          {task.error}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {task.status === 'paused' ? (
          <>
            <Button size="sm" onClick={() => onAct(task.id, 'resume')} disabled={busy}>
              {busy ? <Spinner /> : null} 放行下一步
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAct(task.id, 'run-to-end')}
              disabled={busy}
            >
              运行到底
            </Button>
          </>
        ) : null}
        {task.status === 'failed' ? (
          <Button size="sm" onClick={() => onAct(task.id, 'retry')} disabled={busy}>
            {busy ? <Spinner /> : null} 重试本环节
          </Button>
        ) : null}
        {task.status === 'running' ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> 环节执行中…
          </span>
        ) : null}
        {isAnalyze ? (
          <Button asChild size="sm" variant="ghost">
            <Link to={`/inspect/${task.id}`}>深入检视 →</Link>
          </Button>
        ) : null}
        {ACTIVE.has(task.status) ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => onAct(task.id, 'cancel')}
            disabled={busy}
          >
            取消
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type Act = (taskId: number, path: string) => void;

function PipelineDetailView() {
  const { id } = useParams<{ id: string }>();
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['pipeline-run', id],
    queryFn: () => api.get<RunDetail>(`/pipeline/runs/${id}`),
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? [];
      return tasks.some((t) => ACTIVE.has(t.status)) ? 1500 : false;
    },
  });

  if (q.isError) {
    return (
      <LoadError
        message={q.error instanceof ApiError ? q.error.message : undefined}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (q.isPending) return <Skeleton className="h-96 w-full" />;

  const { run, tasks } = q.data;
  const meta = runStatusMeta(run.status);
  const selected = focusTask(tasks, pickedId);

  const act: Act = (taskId, path) => {
    setBusy(true);
    void (async () => {
      try {
        await api.post(`/pipeline/tasks/${taskId}/${path}`);
        await q.refetch();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '操作失败');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <PageHeader
        title={`进程 #${run.id} · ${run.blueprintLabel ?? kindLabel(run.kind)}`}
        description={`${tasks.length} 个任务 · ${run.tasksDone} 完成${run.tasksFailed > 0 ? ` · ${run.tasksFailed} 失败` : ''} · ${timeAgo(run.finishedAt ?? run.startedAt)}`}
        actions={<Badge variant={meta.variant}>{meta.label}</Badge>}
      />
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">该进程未派生任何任务。</p>
      ) : (
        <>
          <RunGraph tasks={tasks} selectedId={selected?.id ?? null} onSelect={setPickedId} />
          {selected ? <TaskPanel task={selected} onAct={act} busy={busy} /> : null}
        </>
      )}
    </>
  );
}

/** 进程详情页（analyze:run）：任务血缘流程图（react-flow）+ 选中任务的环节轨迹与闸门控制。 */
export function PipelineDetailPage() {
  return (
    <RequirePerm perm="analyze:run">
      <PipelineDetailView />
    </RequirePerm>
  );
}
