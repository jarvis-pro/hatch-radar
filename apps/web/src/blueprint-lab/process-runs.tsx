/**
 * 进程运行记录页（原型，mock 数据）：某进程历次运行的完整列表，从进程卡片「运行记录」跳入。
 * 路由 /processes/:id/runs，分页走 ?page=N（沿用全仓 <Pagination> 链接式分页）。
 */
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ListChecks, Timer } from 'lucide-react';
import { PAGE_SIZE } from '@hatch-radar/shared';
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
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState, LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { StatCard } from '@/components/stat-card';
import { fmtDuration, parsePage } from '@/lib/format';
import { KIND_META, PROCESS_STATUS_META, RUN_STATUS_META, RUN_TRIGGER_META } from './constants';
import { mockApi } from './mock';
import type { Run } from './types';
import { absTime, KEYS, relTime, triggerSummary } from './util';

/** 运行耗时（分钟，整数）；进行中 / 缺时间戳显示占位。 */
function runDuration(startedAt: number, finishedAt: number | null): string {
  if (finishedAt == null) return '进行中';
  return `${Math.max(1, Math.round((finishedAt - startedAt) / 60_000))} 分钟`;
}

/** 任务构成分段条：完成（主色）· 略过（灰）· 失败（红），剩余轨道 = 待办（进行中可见）。 */
function TaskBar({ run }: { run: Run }) {
  const total = Math.max(1, run.tasksTotal);
  const pct = (n: number): string => `${(n / total) * 100}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="bg-primary" style={{ width: pct(run.tasksDone) }} />
      <div className="bg-muted-foreground/40" style={{ width: pct(run.tasksSkipped) }} />
      <div className="bg-destructive" style={{ width: pct(run.tasksFailed) }} />
    </div>
  );
}

/** 触发来源：图标 + 文案（手动「立即触发」最醒目）。 */
function TriggerCell({ run }: { run: Run }) {
  const meta = RUN_TRIGGER_META[run.triggerSource];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {meta.label}
    </span>
  );
}

/** 运行聚合指标条（成功率 / 平均耗时 / 失败 等总览，回答「这进程跑得健康吗」）。 */
function RunStatsStrip({ processId }: { processId: string }) {
  const statsQ = useQuery({
    queryKey: KEYS.runStats(processId),
    queryFn: () => mockApi.runStats(processId),
  });
  const s = statsQ.data;
  if (!s) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label="累计运行"
        value={s.total}
        icon={ListChecks}
        hint={s.running > 0 ? `进行中 ${s.running}` : '无进行中'}
      />
      <StatCard
        label="成功率"
        value={s.successRate == null ? '—' : `${Math.round(s.successRate * 100)}%`}
        icon={CheckCircle2}
        hint={`完成 ${s.completed} · 失败 ${s.failed}`}
      />
      <StatCard
        label="平均耗时"
        value={s.avgDurationSec == null ? '—' : fmtDuration(s.avgDurationSec)}
        icon={Timer}
        hint="仅计已结束运行"
      />
      <StatCard
        label="失败"
        value={s.failed}
        icon={AlertTriangle}
        hint={s.lastFailedAt ? `最近 ${relTime(s.lastFailedAt)}` : '无失败记录'}
      />
    </div>
  );
}

function ProcessRunsView() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const page = parsePage(sp.get('page'));

  const procQ = useQuery({
    queryKey: ['bp', 'process', id],
    queryFn: () => mockApi.getProcess(id),
  });
  const bpQ = useQuery({ queryKey: KEYS.blueprints, queryFn: () => mockApi.listBlueprints() });
  const runsQ = useQuery({
    queryKey: KEYS.runsPage(id, page),
    queryFn: () => mockApi.listRuns(id, page),
  });

  const process = procQ.data;
  const blueprint = bpQ.data?.find((b) => b.id === process?.blueprintId);
  const isRecheck = blueprint?.kind === 'recheck';
  const paged = runsQ.data;
  const runs = paged?.items ?? [];

  return (
    <>
      {procQ.isError ? (
        <LoadError onRetry={() => void procQ.refetch()} />
      ) : procQ.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : !process ? (
        <EmptyState title="进程不存在" hint="它可能已被删除。返回进程列表看看。" />
      ) : (
        <>
          <PageHeader
            title={process.label}
            description={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>运行记录 · {triggerSummary(process.trigger)}</span>
                {blueprint ? (
                  <Badge variant="outline" className="font-normal">
                    {KIND_META[blueprint.kind].label} · {blueprint.label}
                  </Badge>
                ) : null}
              </span>
            }
            actions={
              <Badge variant={PROCESS_STATUS_META[process.status].variant}>
                {PROCESS_STATUS_META[process.status].label}
              </Badge>
            }
          />

          <div className="space-y-5">
            <RunStatsStrip processId={id} />

            {runsQ.isError ? (
              <LoadError onRetry={() => void runsQ.refetch()} />
            ) : runsQ.isPending || !paged ? (
              <Skeleton className="h-64 w-full" />
            ) : paged.total === 0 ? (
              <EmptyState title="暂无运行记录" hint="进程触发后，每一次运行都会记录在这里。" />
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">运行</TableHead>
                        <TableHead className="w-20">触发</TableHead>
                        <TableHead className="w-20">状态</TableHead>
                        {isRecheck ? <TableHead className="w-16">sweep</TableHead> : null}
                        <TableHead className="min-w-[12rem]">进度</TableHead>
                        <TableHead className="w-24">耗时</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((r, i) => {
                        const meta = RUN_STATUS_META[r.status];
                        // 运行序号 #N：最新一条 = 总数，向旧递减（跨页连续，可被引用）。
                        const ordinal = paged.total - ((paged.page - 1) * PAGE_SIZE + i);
                        return (
                          <TableRow
                            key={r.id}
                            className="cursor-pointer"
                            onClick={() =>
                              navigate(`/processes/${id}/runs/${r.id}`, { state: { ordinal } })
                            }
                          >
                            <TableCell>
                              <div className="font-mono text-sm font-medium tabular-nums text-foreground">
                                #{ordinal}
                              </div>
                              <div
                                className="text-xs text-muted-foreground"
                                title={absTime(r.startedAt)}
                              >
                                {relTime(r.startedAt)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <TriggerCell run={r} />
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={meta.variant}
                                title={r.status === 'failed' && r.error ? r.error : undefined}
                              >
                                {meta.label}
                              </Badge>
                            </TableCell>
                            {isRecheck ? (
                              <TableCell className="text-sm tabular-nums text-muted-foreground">
                                {r.sweepSeq ?? '—'}
                              </TableCell>
                            ) : null}
                            <TableCell>
                              <div className="space-y-1.5">
                                <TaskBar run={r} />
                                <div className="text-xs tabular-nums text-muted-foreground">
                                  {r.tasksDone}/{r.tasksTotal} 完成
                                  {r.tasksSkipped > 0 ? ` · 略过 ${r.tasksSkipped}` : ''}
                                  {r.tasksFailed > 0 ? (
                                    <span className="text-destructive">
                                      {' '}
                                      · 失败 {r.tasksFailed}
                                    </span>
                                  ) : null}
                                </div>
                                {r.status === 'failed' && r.error ? (
                                  <div
                                    className="truncate text-xs text-destructive/90"
                                    title={r.error}
                                  >
                                    {r.error}
                                  </div>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell
                              className="text-sm tabular-nums text-muted-foreground"
                              title={r.finishedAt ? `结束于 ${absTime(r.finishedAt)}` : undefined}
                            >
                              {runDuration(r.startedAt, r.finishedAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <Pagination
                  page={paged.page}
                  pageCount={paged.pageCount}
                  total={paged.total}
                  basePath={`/processes/${id}/runs`}
                  query={{}}
                />
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** 运行记录页（原型）。沿用 analyze:run 能力。 */
export function ProcessRunsPage() {
  return (
    <RequirePerm perm="analyze:run">
      <ProcessRunsView />
    </RequirePerm>
  );
}
