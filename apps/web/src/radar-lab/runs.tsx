/**
 * 运行历史（/radar/processes/:id/runs）—— 某进程历次运行，让闭环可导航（指挥室 → 历史 → 某次运行）。
 */
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ListChecks, Timer } from 'lucide-react';
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
import { cn } from '@hatch-radar/ui/lib/utils';
import type { RunDTO } from '@hatch-radar/shared';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { fmtDuration, timeAgo } from '@/lib/format';
import { KIND_META, RUN_STATUS_META } from './constants';
import { useProcessRuns } from './hooks';
import { triggerSummary } from './util';

/** 运行状态展示（兜底未登记的状态，如 paused）。 */
function runStatusMeta(s: string): {
  label: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
} {
  return RUN_STATUS_META[s as keyof typeof RUN_STATUS_META] ?? { label: s, variant: 'outline' };
}

/** 单次运行任务进度（done 含略过，与后端 tasksDone 口径一致）。 */
function runProgress(run: RunDTO): { total: number; done: number; failed: number; pct: number } {
  const total = run.tasksTotal;
  const done = run.tasksDone;
  const failed = run.tasksFailed;
  const pct = total > 0 ? Math.round((done / total) * 100) : run.status === 'completed' ? 100 : 0;
  return { total, done, failed, pct };
}

function RunsView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useProcessRuns(id);

  if (q.isError) return <LoadError onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-96 w-full" />;

  const { process, runs } = q.data;
  if (!process) return <EmptyState title="进程不存在" hint="它可能已被删除。返回指挥室看看。" />;

  const isRecheck = process.blueprintKind === 'recheck';
  const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt);

  // 统计（客户端派生）
  const completed = sorted.filter((r) => r.status === 'completed').length;
  const failed = sorted.filter((r) => r.status === 'failed').length;
  const settled = completed + failed;
  const successRate = settled > 0 ? completed / settled : null;
  const durs = sorted.filter((r) => r.finishedAt != null).map((r) => r.finishedAt! - r.startedAt);
  const avgSec = durs.length > 0 ? durs.reduce((a, b) => a + b, 0) / durs.length : null;
  const running = sorted.filter((r) => r.status === 'running').length;

  return (
    <>
      <PageHeader
        title={process.label}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>运行历史 · {triggerSummary(process.trigger)}</span>
            <Badge variant="outline" className="font-normal">
              {KIND_META[process.blueprintKind].label}
            </Badge>
          </span>
        }
      />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="累计运行"
            value={sorted.length}
            icon={ListChecks}
            hint={running > 0 ? `进行中 ${running}` : '无进行中'}
          />
          <StatCard
            label="成功率"
            value={successRate == null ? '—' : `${Math.round(successRate * 100)}%`}
            icon={CheckCircle2}
            hint={`完成 ${completed} · 失败 ${failed}`}
          />
          <StatCard
            label="平均耗时"
            value={avgSec == null ? '—' : fmtDuration(avgSec)}
            icon={Timer}
            hint="仅计已结束"
          />
          <StatCard label="失败" value={failed} icon={AlertTriangle} hint="失败运行数" />
        </div>

        {sorted.length === 0 ? (
          <EmptyState title="暂无运行记录" hint="进程触发后，每次运行都会记录在这里。" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">运行</TableHead>
                  <TableHead className="w-20">状态</TableHead>
                  {isRecheck ? <TableHead className="w-16">sweep</TableHead> : null}
                  <TableHead className="min-w-[12rem]">进度</TableHead>
                  <TableHead className="w-24">耗时</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((run, i) => {
                  const meta = runStatusMeta(run.status);
                  const { total, done, failed: runFailed, pct } = runProgress(run);
                  const ordinal = sorted.length - i;
                  return (
                    <TableRow
                      key={run.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/radar/runs/${run.id}`)}
                    >
                      <TableCell>
                        <div className="font-mono text-sm font-medium tabular-nums">#{ordinal}</div>
                        <div className="text-xs text-muted-foreground">
                          {timeAgo(run.startedAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={meta.variant} title={run.error ?? undefined}>
                          {meta.label}
                        </Badge>
                      </TableCell>
                      {isRecheck ? (
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {run.sweepSeq ?? '—'}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="space-y-1.5">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-xs tabular-nums text-muted-foreground">
                            {total > 0 ? `${done}/${total} 任务` : '—'}
                            {runFailed > 0 ? (
                              <span className="text-destructive"> · 失败 {runFailed}</span>
                            ) : null}
                          </div>
                          {run.status === 'failed' && run.error ? (
                            <div
                              className={cn('truncate text-xs text-destructive/90')}
                              title={run.error}
                            >
                              {run.error}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {run.finishedAt != null
                          ? fmtDuration(run.finishedAt - run.startedAt)
                          : '进行中'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}

export function RadarRunsPage() {
  return (
    <RequirePerm perm="analyze:run">
      <RunsView />
    </RequirePerm>
  );
}
