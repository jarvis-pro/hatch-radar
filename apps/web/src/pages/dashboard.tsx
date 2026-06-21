import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, ServerOff, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { DashboardData, ThroughputPoint, WorkerStatus } from '@hatch-radar/shared';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@hatch-radar/ui/components/chart';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { fmtDuration } from '@/lib/format';

/** 成本（美元）→ 紧凑展示 */
function fmtCost(cost: number | null): string {
  if (cost == null) return '—';
  return `$${cost < 1 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

/** 紧凑数字（12345 → 12.3K），用于 token 量纵轴刻度 */
const compactInt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
/** 'YYYY-MM-DD' → 'M/D'（横轴刻度） */
function fmtDayShort(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}
/** 'YYYY-MM-DD' → 'M 月 D 日'（tooltip 标题） */
function fmtDayLong(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}

/** 每日 token 用量堆叠柱配色（chart-1..4 = 输入/输出/缓存写/缓存读） */
const COST_CHART_CONFIG = {
  inputTokens: { label: '输入', color: 'var(--chart-1)' },
  outputTokens: { label: '输出', color: 'var(--chart-2)' },
  cacheWriteTokens: { label: '缓存写入', color: 'var(--chart-3)' },
  cacheReadTokens: { label: '缓存命中', color: 'var(--chart-4)' },
} satisfies ChartConfig;
/** 走势图可选时间窗（天） */
const COST_RANGES = [7, 14, 30] as const;

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

/** 吞吐配色：完成=signal 青 / 失败=destructive 红 */
const THROUGHPUT_CONFIG = {
  succeeded: { label: '完成', color: 'var(--signal)' },
  failed: { label: '失败', color: 'var(--destructive)' },
} satisfies ChartConfig;

/**
 * 吞吐趋势：每日「完成 / 失败」堆叠柱（单轴）。与成本面板同为柱状，全页趋势图形态统一；
 * 洞察产出趋势不在此叠加（避免柱+线双轴的视觉割裂与误导），已由「今日产出」「洞察分布」承载。
 */
function ThroughputChart({ points }: { points: ThroughputPoint[] }) {
  return (
    <ChartContainer config={THROUGHPUT_CONFIG} className="aspect-auto h-56 w-full">
      <BarChart accessibilityLayer data={points} margin={{ top: 8, right: 8, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={20}
          tickFormatter={fmtDayShort}
        />
        <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => fmtDayLong(String(label))}
              formatter={(value, name, item) => (
                <div className="flex w-full items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ background: item.color }}
                  />
                  <span className="text-muted-foreground">
                    {THROUGHPUT_CONFIG[name as keyof typeof THROUGHPUT_CONFIG]?.label ?? name}
                  </span>
                  <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                    {Number(value).toLocaleString()}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="succeeded" stackId="t" fill="var(--color-succeeded)" />
        <Bar dataKey="failed" stackId="t" fill="var(--color-failed)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

const INTENSITY_LABEL: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };
/** 强度语义色（红/琥珀/翠，全站统一） */
const INTENSITY_FILL: Record<string, string> = {
  HIGH: 'var(--intensity-high)',
  MEDIUM: 'var(--intensity-medium)',
  LOW: 'var(--intensity-low)',
};
/** 强度有序：高 > 中 > 低（条形按此从上到下排序，保证 ordinal 读法） */
const INTENSITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
/**
 * Top 版块：横向条形榜（按洞察数降序，单色品牌条 + 右侧计数）。取代旧甜甜圈——
 * 榜单是「排序」而非「分类」，单色即可，既免去多类目撞色，又与强度条统一为横向条语汇。
 */
function SubredditBars({ data }: { data: { key: string; name: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <BarRow
          key={d.key}
          label={
            <span className="font-mono" title={d.name}>
              {d.name}
            </span>
          }
          value={d.value}
          max={max}
        />
      ))}
    </div>
  );
}

/**
 * 洞察强度分布：三条同基线横向条（高 > 中 > 低 顺序，条长＝相对最大档，右侧「计数 · 占比」）。
 * 取代旧甜甜圈——3 个有序值用同基线条比角度更易精确比较，且占比最小的「高」也清晰可读。
 */
function IntensityBars({
  data,
}: {
  data: { key: string; name: string; value: number; fill: string }[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-3.5">
      {data.map((d) => {
        const share = total > 0 ? Math.round((d.value / total) * 100) : 0;
        return (
          <div key={d.key} className="flex items-center gap-3 text-xs">
            <div className="w-6 shrink-0 text-muted-foreground">{d.name}</div>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(d.value / max) * 100}%`, background: d.fill }}
              />
            </div>
            <div className="w-24 shrink-0 text-right tabular-nums">
              <span className="font-mono font-medium">{d.value.toLocaleString()}</span>
              <span className="text-muted-foreground"> · {share}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 利用率细条：标签 + 数值 + 进度条；负载分级着色（≥85% 红 / ≥60% 琥珀 / 否则 signal），可被 barClass 覆盖 */
function Meter({
  label,
  value,
  max,
  display,
  barClass,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  barClass?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone =
    barClass ?? (pct >= 85 ? 'bg-intensity-high' : pct >= 60 ? 'bg-intensity-medium' : 'bg-signal');
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{display}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Worker 单卡：心跳状态 + 并发饱和度条；CPU/内存降为小字读数（不再常驻进度条）。 */
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
          {fmtDuration(w.lastHeartbeatAgo)}前
        </span>
      </div>
      <div className="mt-2.5">
        <Meter
          label="并发"
          value={w.activeJobs}
          max={w.concurrency}
          display={`${w.activeJobs}/${w.concurrency}`}
          barClass="bg-primary"
        />
        <div className="mt-2 text-[11px] tabular-nums text-muted-foreground">
          CPU {Math.round(w.cpu)}% · 内存 {Math.round(w.memory)}%
        </div>
      </div>
    </div>
  );
}

/**
 * 队列概况：实时「排队 / 运行中」为主（运行中有任务时脉冲），累计「成功 / 失败」降为脚注。
 * 分层呈现避免四数等重并列把累计虚荣数顶到最显眼；「已取消」恒为 0（无取消入口）不展示。
 */
function QueueOverview({ queue }: { queue: DashboardData['queue'] }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border bg-background p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: 'var(--chart-1)' }}
            />
            排队
          </div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {queue.queued.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full bg-signal',
                queue.running > 0 && 'signal-pulse',
              )}
            />
            运行中
          </div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {queue.running.toLocaleString()}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-2.5 text-[11px] text-muted-foreground">
        <span>累计</span>
        <span className="tabular-nums">
          成功{' '}
          <span className="font-mono font-medium text-foreground">
            {queue.succeeded.toLocaleString()}
          </span>
          {' · 失败 '}
          <span
            className={cn(
              'font-mono font-medium',
              queue.failed > 0 ? 'text-intensity-high' : 'text-foreground',
            )}
          >
            {queue.failed.toLocaleString()}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Token / 成本面板：窗口总计（总成本大数字 + 各类 token）+ 每日 token 用量堆叠柱（当天成本在
 * tooltip 标题显示，可切 7/14/30 天）+ 按模型拆分。全部模型都未配单价时退化为纯 token 用量走势。
 */
function CostPanel({ cost }: { cost: DashboardData['cost'] }) {
  const [range, setRange] = useState<number>(cost.windowDays);
  const data = cost.daily.slice(-range);
  const hasTokens = data.some(
    (p) => p.inputTokens + p.outputTokens + p.cacheWriteTokens + p.cacheReadTokens > 0,
  );
  const modelMax = Math.max(1, ...cost.byModel.map((m) => m.inputTokens + m.outputTokens));
  const tokenCells: { label: string; value: number }[] = [
    { label: '输入', value: cost.inputTokens },
    { label: '输出', value: cost.outputTokens },
    { label: '缓存写入', value: cost.cacheWriteTokens },
    { label: '缓存命中', value: cost.cacheReadTokens },
  ];

  const title = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>Token / 成本（近 {cost.windowDays} 天）</span>
      <div className="flex items-center gap-0.5 rounded-md border p-0.5">
        {COST_RANGES.filter((r) => r <= cost.windowDays).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium tabular-nums transition-colors',
              range === r
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {r} 天
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Section title={title}>
      {/* 窗口总计 */}
      <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="font-mono text-2xl font-semibold tabular-nums">
            {fmtCost(cost.totalCost)}
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

      {/* 每日走势：token 用量堆叠柱（当天成本在 tooltip 标题显示） */}
      {!hasTokens ? (
        <p className="text-sm text-muted-foreground">
          窗口内暂无带 token 记录的任务。重启 worker 并在设置页配单价后，新任务会在此统计。
        </p>
      ) : (
        <ChartContainer config={COST_CHART_CONFIG} className="aspect-auto h-64 w-full">
          <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={fmtDayShort}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v) => compactInt.format(v as number)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(label, payload) => {
                    const c = (payload?.[0]?.payload as { cost?: number | null } | undefined)?.cost;
                    return `${fmtDayLong(String(label))}${c != null ? ` · ${fmtCost(c)}` : ''}`;
                  }}
                  formatter={(value, name, item) => (
                    <div className="flex w-full items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ background: item.color }}
                      />
                      <span className="text-muted-foreground">
                        {COST_CHART_CONFIG[name as keyof typeof COST_CHART_CONFIG]?.label ?? name}
                      </span>
                      <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                        {Number(value).toLocaleString()}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="inputTokens" stackId="t" fill="var(--color-inputTokens)" />
            <Bar dataKey="outputTokens" stackId="t" fill="var(--color-outputTokens)" />
            <Bar dataKey="cacheWriteTokens" stackId="t" fill="var(--color-cacheWriteTokens)" />
            <Bar
              dataKey="cacheReadTokens"
              stackId="t"
              fill="var(--color-cacheReadTokens)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      )}

      {/* 按模型拆分（token 量条 + 折算成本） */}
      {cost.byModel.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t pt-4">
          {cost.byModel.map((m) => (
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
  );
}

/**
 * 异常告警条：仅在有「需要动手」的异常时渲染（无 Worker＝停摆 / 今日有失败任务），否则返回 null。
 * 把要处理的事顶到第一屏——取代旧看板「全是中性等重聚合、要人用眼睛 diff」的缺陷。
 */
function AlertBar({
  workers,
  todayFailed,
  pending,
}: {
  workers: number;
  todayFailed: number;
  pending: number;
}) {
  const alerts: { key: string; level: 'danger' | 'warning'; icon: LucideIcon; text: string }[] = [];
  if (workers === 0) {
    alerts.push({
      key: 'no-worker',
      level: 'danger',
      icon: ServerOff,
      text: `无在线 Worker，分析已停摆${pending > 0 ? ` · 积压 ${pending.toLocaleString()}` : ''}`,
    });
  }
  if (todayFailed > 0) {
    alerts.push({
      key: 'failed',
      level: 'warning',
      icon: TriangleAlert,
      text: `今日 ${todayFailed.toLocaleString()} 个分析任务失败`,
    });
  }
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.key}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm',
            a.level === 'danger'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-intensity-medium/30 bg-intensity-medium/10 text-intensity-medium',
          )}
        >
          <a.icon className="size-4 shrink-0" />
          <span>{a.text}</span>
        </div>
      ))}
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
    return (
      <LoadError
        message={q.error instanceof ApiError ? q.error.message : undefined}
        onRetry={() => void q.refetch()}
      />
    );
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
  // 今日失败数取吞吐序列末位（14 天密集序列，末位＝今日），喂给基础设施告警条
  const todayFailed = d.throughput[d.throughput.length - 1]?.failed ?? 0;
  const intensityData = d.insights.byIntensity
    .map((i) => ({
      key: i.name,
      name: INTENSITY_LABEL[i.name] ?? i.name,
      value: i.count,
      fill: INTENSITY_FILL[i.name] ?? 'var(--chart-1)',
    }))
    .sort((a, b) => (INTENSITY_RANK[a.key] ?? 99) - (INTENSITY_RANK[b.key] ?? 99));
  const subredditData = d.insights.topSubreddits.map((s) => ({
    key: s.name,
    name: s.name,
    value: s.count,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据看板"
        description="产出趋势、成本与基础设施健康 · 每 5 秒刷新（实时操作台见指挥室）"
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
            <span className="signal-pulse size-1.5 rounded-full bg-signal" />
            实时
          </span>
        }
      />

      {/* 异常告警（仅在有异常时出现） */}
      <AlertBar
        workers={d.workers.length}
        todayFailed={todayFailed}
        pending={d.overview.pendingAnalysis}
      />

      {/* 吞吐趋势 */}
      <Section title="吞吐趋势（近 14 天每日完成 / 失败）">
        <ThroughputChart points={d.throughput} />
      </Section>

      {/* 成本 / token */}
      <CostPanel cost={d.cost} />

      {/* 洞察分布 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="洞察强度分布">
          {intensityData.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无洞察。</p>
          ) : (
            <IntensityBars data={intensityData} />
          )}
        </Section>

        <Section title="Top 版块（按洞察数）">
          {subredditData.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无洞察。</p>
          ) : (
            <SubredditBars data={subredditData} />
          )}
        </Section>
      </div>

      {/* 系统健康（运维，置于页尾——价值在前、基础设施在后） */}
      <div>
        <div className="mb-3 text-sm font-medium text-muted-foreground">系统健康</div>
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
            <QueueOverview queue={d.queue} />
          </Section>
        </div>
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
