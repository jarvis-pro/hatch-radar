import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { fmtDuration, timeAgo } from '@/lib/format';
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

interface TaskView {
  id: number;
  kind: string;
  status: string;
  postId: string | null;
  model: string | null;
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

const STAGE_STATUS_META: Record<string, { variant: Variant; dot: string }> = {
  pending: { variant: 'outline', dot: 'bg-muted-foreground/40' },
  running: { variant: 'default', dot: 'bg-primary animate-pulse' },
  done: { variant: 'secondary', dot: 'bg-primary' },
  skipped: { variant: 'outline', dot: 'bg-muted-foreground/30' },
  failed: { variant: 'destructive', dot: 'bg-destructive' },
};

/** 环节耗时（秒）：done/failed 用起止；running 用至今；未起返回 null */
function stageDuration(s: StageView, now: number): number | null {
  if (s.startedAt == null) return null;
  const end = s.finishedAt ?? (s.status === 'running' ? now : null);
  return end == null ? null : Math.max(0, end - s.startedAt);
}

/** 单环节小条：状态点 + 环节名（+ 失败时高亮 + 耗时 title） */
function StageChip({ stage, now }: { stage: StageView; now: number }) {
  const meta = STAGE_STATUS_META[stage.status] ?? STAGE_STATUS_META.pending!;
  const dur = stageDuration(stage, now);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
      title={`${stage.status}${dur != null ? ` · ${fmtDuration(dur)}` : ''}${stage.error ? ` · ${stage.error}` : ''}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      <span className={stage.status === 'failed' ? 'text-destructive' : undefined}>{stage.name}</span>
    </span>
  );
}

/** 单个任务卡：头部（状态/帖子/模型/token）+ 环节轨迹小条 */
function TaskCard({ task, now }: { task: TaskView; now: number }) {
  const meta = TASK_STATUS_META[task.status] ?? { label: task.status, variant: 'outline' as const };
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={meta.variant}>{meta.label}</Badge>
        <span className="text-xs text-muted-foreground">{kindLabel(task.kind)}</span>
        {task.postId ? (
          <Link
            to={`/posts/${task.postId}`}
            className="min-w-0 truncate font-mono text-xs hover:underline"
          >
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
      {task.stages.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.stages.map((s) => (
            <StageChip key={s.seq} stage={s} now={now} />
          ))}
        </div>
      ) : null}
      {task.error ? <p className="mt-2 text-xs text-destructive">{task.error}</p> : null}
    </div>
  );
}

function PipelineDetailView() {
  const { id } = useParams<{ id: string }>();
  const now = Math.floor(Date.now() / 1000);
  const q = useQuery({
    queryKey: ['pipeline-run', id],
    queryFn: () => api.get<RunDetail>(`/pipeline/runs/${id}`),
    refetchInterval: (query) => {
      const s = query.state.data?.run.status;
      return s === 'running' || s === 'paused' ? 1500 : false;
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
        <div className="space-y-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} now={now} />
          ))}
        </div>
      )}
    </>
  );
}

/** 进程详情页（analyze:run）：进程元信息 + 任务树（每任务含其环节轨迹）。 */
export function PipelineDetailPage() {
  return (
    <RequirePerm perm="analyze:run">
      <PipelineDetailView />
    </RequirePerm>
  );
}
