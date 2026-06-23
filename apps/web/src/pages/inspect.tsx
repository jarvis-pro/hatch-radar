import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  INSPECT_STEP_LABELS,
  type InspectJobView,
  type InspectStepName,
  type InspectStepView,
} from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { toast } from '@hatch-radar/ui/components/sonner';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { FlowDiagram } from '@/components/pipeline/flow-diagram';
import { NodePanel } from '@/components/pipeline/node-panel';

const STATUS_META: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  queued: { label: '排队中', variant: 'outline' },
  running: { label: '运行中', variant: 'default' },
  paused: { label: '已暂停', variant: 'outline' },
  succeeded: { label: '已完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '已取消', variant: 'outline' },
};

const ACTIVE = new Set(['queued', 'running', 'paused']);

/** 当前最相关节点：运行中 > 失败 > 最近完成 > 第一个（决定面板默认聚焦）。 */
function currentSeq(steps: InspectStepView[]): number {
  const running = steps.find((s) => s.status === 'running');
  if (running) {
    return running.seq;
  }
  const failed = steps.find((s) => s.status === 'failed');
  if (failed) {
    return failed.seq;
  }
  const done = steps.filter((s) => s.status === 'done');
  if (done.length) {
    return done[done.length - 1]!.seq;
  }
  return steps[0]?.seq ?? 0;
}

function InspectView() {
  const { jobId } = useParams<{ jobId: string }>();
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['inspect', jobId],
    queryFn: () => api.get<InspectJobView>(`/analysis/inspect/${jobId}`),
    // running/queued 快轮询（尤其 ai_call 进行中），paused 慢轮询，终态停轮询
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === 'running' || s === 'queued') {
        return 1500;
      }
      if (s === 'paused') {
        return 2500;
      }
      return false;
    },
  });

  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0;
    return status === 404 ? (
      <EmptyState title="检视任务不存在" hint="任务可能已被清理。回到队列查看其它任务。" />
    ) : (
      <LoadError
        message={q.error instanceof ApiError ? q.error.message : undefined}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (q.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  const job = q.data;
  const steps = job.steps;
  const selectedSeq = picked ?? currentSeq(steps);
  const selected = steps.find((s) => s.seq === selectedSeq) ?? steps[0];
  const nextPending = steps.find((s) => s.status === 'pending');
  const statusMeta = STATUS_META[job.status] ?? { label: job.status, variant: 'outline' as const };

  /** 发一个控制动作，成功后立刻刷新视图。followCurrent=true 时把面板交回自动聚焦。 */
  async function act(path: string, followCurrent = false): Promise<void> {
    setBusy(true);
    try {
      await api.post(`/analysis/inspect/${jobId}/${path}`);
      if (followCurrent) {
        setPicked(null);
      }
      await q.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="流水线检视"
        description={job.postTitle ?? job.postId}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/radar/posts/${job.postId}`}>查看原帖</Link>
            </Button>
          </div>
        }
      />

      {/* 模型 + 任务元信息 */}
      <p className="mb-4 text-sm text-muted-foreground">
        模型 <span className="font-mono text-xs">{job.model}</span>
        {job.provider ? ` · ${job.provider}` : ''}
        {job.stepGate ? ' · 逐节点暂停' : ' · 运行到底'}
      </p>

      {/* 横向管道线路图 */}
      <div className="rounded-lg border p-4">
        <FlowDiagram steps={steps} selectedSeq={selectedSeq} onSelect={setPicked} />
      </div>

      {/* 任务级错误（节点失败会冒泡到 job.error） */}
      {job.status === 'failed' && job.error ? (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {job.error}
        </div>
      ) : null}

      {/* 当前 / 选中节点的完整产物 */}
      <div className="mt-4 rounded-lg border p-4">
        {selected ? <NodePanel step={selected} postId={job.postId} /> : null}
      </div>

      {/* 控制条 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {job.status === 'paused' ? (
          <Button onClick={() => void act('resume', true)} disabled={busy}>
            {busy ? <Spinner /> : null}
            继续下一步
            {nextPending
              ? `：${INSPECT_STEP_LABELS[nextPending.name as InspectStepName] ?? nextPending.name}`
              : ''}
          </Button>
        ) : null}

        {ACTIVE.has(job.status) && job.stepGate ? (
          <Button variant="outline" onClick={() => void act('run-to-end', true)} disabled={busy}>
            运行到底
          </Button>
        ) : null}

        {job.status === 'failed' ? (
          <Button onClick={() => void act('retry-step', true)} disabled={busy}>
            {busy ? <Spinner /> : null}
            重试本节点
          </Button>
        ) : null}

        {job.status === 'running' ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> 节点执行中…
          </span>
        ) : null}

        {ACTIVE.has(job.status) ? (
          <Button variant="ghost" onClick={() => void act('cancel')} disabled={busy}>
            取消
          </Button>
        ) : null}

        {job.status === 'succeeded' ? (
          <Button asChild variant="outline">
            <Link to={`/radar/posts/${job.postId}`}>查看帖子与洞察 →</Link>
          </Button>
        ) : null}
      </div>
    </>
  );
}

/** 流水线检视页（analyze:run）：横向管道线路图 + 节点产物面板 + 控制条，轮询刷新。 */
export function InspectPage() {
  return (
    <RequirePerm perm="analyze:run">
      <InspectView />
    </RequirePerm>
  );
}
