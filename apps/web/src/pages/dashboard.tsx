import { type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Cpu, FileText, Server, Sparkles } from 'lucide-react';
import type {
  CostByModel,
  DashboardData,
  NamedCount,
  ThroughputPoint,
  WorkerStatus,
} from '@hatch-radar/shared';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { fmtDuration } from '@/lib/format';

/** 成本（美元）→ 紧凑展示 */
function fmtCost(cost: number | null): string {
  if (cost == null) return '—';
  return `$${cost < 1 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

/** 版块容器 */
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3 text-sm font-medium">{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** 水平占比条 */
function BarRow({
  label,
  value,
  max,
  valueText,
  barClass = 'bg-primary',
}: {
  label: ReactNode;
  value: number;
  max: number;
  valueText?: string;
  barClass?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-24 shrink-0 truncate text-muted-foreground">{label}</div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-20 shrink-0 text-right font-mono tabular-nums">
        {valueText ?? value.toLocaleString()}
      </div>
    </div>
  );
}

/** 吞吐趋势：每日完成数竖向柱图（数据已是 0 填充的密集序列） */
function ThroughputChart({ points }: { points: ThroughputPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div className="flex h-32 items-end gap-1">
      {points.map((p) => (
        <div
          key={p.date}
          className="group flex h-full flex-1 items-end"
          title={`${p.date}：${p.count} 篇`}
        >
          <div
            className="w-full rounded-t bg-signal/60 transition-colors group-hover:bg-signal"
            style={{ height: `${Math.max(p.count > 0 ? 4 : 0, (p.count / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

const INTENSITY_BAR: Record<string, string> = {
  HIGH: 'bg-intensity-high',
  MEDIUM: 'bg-intensity-medium',
  LOW: 'bg-intensity-low',
};
const INTENSITY_LABEL: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };

/** Worker 单卡 */
function WorkerCard({ w }: { w: WorkerStatus }) {
  const stale = w.lastHeartbeatAgo > 20;
  return (
    <div className="rounded-lg border bg-background p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              stale ? 'bg-destructive' : 'signal-pulse bg-signal',
            )}
          />
          <span className="truncate font-mono font-medium" title={w.workerId}>
            {w.workerId}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 tabular-nums',
            stale ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          心跳 {fmtDuration(w.lastHeartbeatAgo)}前
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="font-mono text-sm font-semibold tabular-nums">
            {w.activeJobs}
            <span className="text-muted-foreground">/{w.concurrency}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">活跃/并发</div>
        </div>
        <div>
          <div className="font-mono text-sm font-semibold tabular-nums">{Math.round(w.cpu)}%</div>
          <div className="text-[11px] text-muted-foreground">CPU</div>
        </div>
        <div>
          <div className="font-mono text-sm font-semibold tabular-nums">
            {Math.round(w.memory)}%
          </div>
          <div className="text-[11px] text-muted-foreground">内存</div>
        </div>
      </div>
    </div>
  );
}

function DashboardView() {
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    refetchInterval: 5000,
  });

  if (q.isError) {
    return <LoadError message={q.error instanceof ApiError ? q.error.message : undefined} />;
  }
  if (q.isPending) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[28rem] w-full rounded-xl" />
      </div>
    );
  }
  const d = q.data;
  const inflight = d.queue.queued + d.queue.running;
  const queueCells: { label: string; value: number }[] = [
    { label: '排队', value: d.queue.queued },
    { label: '运行中', value: d.queue.running },
    { label: '成功', value: d.queue.succeeded },
    { label: '失败', value: d.queue.failed },
    { label: '已取消', value: d.queue.canceled },
  ];
  const tokenCells: { label: string; value: number }[] = [
    { label: '输入', value: d.cost.inputTokens },
    { label: '输出', value: d.cost.outputTokens },
    { label: '缓存写入', value: d.cost.cacheWriteTokens },
    { label: '缓存命中', value: d.cost.cacheReadTokens },
  ];
  const modelMax = Math.max(
    1,
    ...d.cost.byModel.map((m: CostByModel) => m.inputTokens + m.outputTokens),
  );
  const intensityMax = Math.max(1, ...d.insights.byIntensity.map((i: NamedCount) => i.count));
  const subMax = Math.max(1, ...d.insights.topSubreddits.map((s: NamedCount) => s.count));

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            看板
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
              <span className="signal-pulse size-1.5 rounded-full bg-signal" />
              实时
            </span>
          </span>
        }
        description="数据工厂运行概览 · 每 5 秒刷新"
      />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="帖子" icon={FileText} value={d.overview.posts.toLocaleString()} />
        <StatCard label="洞察" icon={Sparkles} value={d.overview.insights.toLocaleString()} />
        <StatCard label="待分析" icon={Clock} value={d.overview.pendingAnalysis.toLocaleString()} />
        <StatCard
          label="在线 Worker"
          icon={Server}
          value={d.workers.length}
          hint={inflight > 0 ? `在飞 ${inflight}` : '空闲'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Worker 状态 */}
        <Section
          title={
            <span className="flex items-center gap-2">
              <Cpu className="size-4 text-muted-foreground" />
              Worker 状态（在线 {d.workers.length}）
            </span>
          }
        >
          {d.workers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无在线 Worker。启动 worker 进程后会连上网关并在此展示。
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {d.workers.map((w) => (
                <WorkerCard key={w.workerId} w={w} />
              ))}
            </div>
          )}
        </Section>

        {/* 队列概况 */}
        <Section title={`队列概况（在飞 ${inflight}）`}>
          <div className="grid grid-cols-5 divide-x rounded-lg border text-center">
            {queueCells.map((c) => (
              <div key={c.label} className="px-1 py-3">
                <div className="font-mono text-base font-semibold tabular-nums">{c.value}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{c.label}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* 吞吐趋势 */}
      <Section title="吞吐趋势（近 14 天每日完成分析数）">
        <ThroughputChart points={d.throughput} />
      </Section>

      {/* 成本 / token */}
      <Section title={`Token / 成本（近 ${d.cost.windowDays} 天）`}>
        <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="font-mono text-2xl font-semibold tabular-nums">
              {fmtCost(d.cost.totalCost)}
            </div>
            <div className="text-xs text-muted-foreground">总成本</div>
          </div>
          {tokenCells.map((c) => (
            <div key={c.label}>
              <div className="font-mono text-base font-semibold tabular-nums">
                {c.value.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">{c.label} token</div>
            </div>
          ))}
        </div>
        {d.cost.byModel.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            窗口内暂无带 token 记录的任务。重启 worker 并在设置页配单价后，新任务会在此统计。
          </p>
        ) : (
          <div className="space-y-1.5">
            {d.cost.byModel.map((m) => (
              <BarRow
                key={`${m.provider}/${m.model}`}
                label={
                  <span title={`${m.provider} · ${m.jobs} 次`} className="font-mono">
                    {m.model}
                  </span>
                }
                value={m.inputTokens + m.outputTokens}
                max={modelMax}
                valueText={fmtCost(m.cost)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* 洞察分布 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="洞察强度分布">
          {d.insights.byIntensity.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无洞察。</p>
          ) : (
            <div className="space-y-1.5">
              {d.insights.byIntensity.map((i) => (
                <BarRow
                  key={i.name}
                  label={INTENSITY_LABEL[i.name] ?? i.name}
                  value={i.count}
                  max={intensityMax}
                  barClass={INTENSITY_BAR[i.name] ?? 'bg-primary'}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Top 版块（按洞察数）">
          {d.insights.topSubreddits.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无洞察。</p>
          ) : (
            <div className="space-y-1.5">
              {d.insights.topSubreddits.map((s) => (
                <BarRow key={s.name} label={s.name} value={s.count} max={subMax} />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/** 看板页（insights:view）：运行概览、Worker 状态、成本与吞吐统计。 */
export function DashboardPage() {
  return (
    <RequirePerm perm="insights:view">
      <DashboardView />
    </RequirePerm>
  );
}
