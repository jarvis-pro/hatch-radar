/**
 * 运行历史（/radar/processes/:id/runs）—— 某进程历次运行，让闭环可导航（指挥室 → 历史 → 某次运行）。
 */
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ListChecks, Timer } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { KIND_META, RUN_STATUS_META } from './constants';
import { useWorld } from './store';
import type { World } from './types';
import { fmtDur, relPast, triggerSummary } from './util';

function selectRuns(w: World, processId: string) {
  const process = w.processes.find((p) => p.id === processId) ?? null;
  const blueprint = process
    ? (w.blueprints.find((b) => b.id === process.blueprintId) ?? null)
    : null;
  const all = w.runs
    .filter((r) => r.processId === processId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((run) => {
      const ts = w.tasks.filter((t) => t.runId === run.id);
      const total = ts.length;
      const done = ts.filter((t) => t.status === 'succeeded' || t.status === 'skipped').length;
      const failed = ts.filter((t) => t.status === 'failed').length;
      const pct =
        total > 0 ? Math.round((done / total) * 100) : run.status === 'completed' ? 100 : 0;
      return { run, total, done, failed, pct };
    });
  const completed = all.filter((r) => r.run.status === 'completed').length;
  const failedRuns = all.filter((r) => r.run.status === 'failed').length;
  const settled = completed + failedRuns;
  const successRate = settled > 0 ? completed / settled : null;
  const durs = all.filter((r) => r.run.finishedAt).map((r) => r.run.finishedAt! - r.run.startedAt);
  const avgMs = durs.length > 0 ? durs.reduce((a, b) => a + b, 0) / durs.length : null;
  const running = all.filter((r) => r.run.status === 'running').length;
  return {
    process,
    blueprint,
    rows: all,
    stats: { total: all.length, completed, failed: failedRuns, successRate, avgMs, running },
    nowMs: w.nowMs,
  };
}

function RunsView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const d = useWorld((w) => selectRuns(w, id));
  const isRecheck = d.blueprint?.kind === 'recheck';

  if (!d.process) return <EmptyState title="进程不存在" hint="它可能已被删除。返回指挥室看看。" />;
  const s = d.stats;

  return (
    <>
      <PageHeader
        title={d.process.label}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>运行历史 · {triggerSummary(d.process.trigger)}</span>
            {d.blueprint ? (
              <Badge variant="outline" className="font-normal">
                {KIND_META[d.blueprint.kind].label} · {d.blueprint.label}
              </Badge>
            ) : null}
          </span>
        }
      />
      <div className="space-y-5">
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
            value={s.avgMs == null ? '—' : fmtDur(s.avgMs)}
            icon={Timer}
            hint="仅计已结束"
          />
          <StatCard label="失败" value={s.failed} icon={AlertTriangle} hint="失败运行数" />
        </div>

        {d.rows.length === 0 ? (
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
                {d.rows.map(({ run, total, done, failed, pct }, i) => {
                  const meta = RUN_STATUS_META[run.status];
                  const ordinal = d.rows.length - i;
                  return (
                    <TableRow
                      key={run.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/radar/runs/${run.id}`)}
                    >
                      <TableCell>
                        <div className="font-mono text-sm font-medium tabular-nums">#{ordinal}</div>
                        <div className="text-xs text-muted-foreground">
                          {relPast(run.startedAt, d.nowMs)}
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
                            {failed > 0 ? (
                              <span className="text-destructive"> · 失败 {failed}</span>
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
                        {run.finishedAt ? fmtDur(run.finishedAt - run.startedAt) : '进行中'}
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
