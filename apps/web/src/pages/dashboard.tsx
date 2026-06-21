import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BoardData, BoardRange, FunnelTrendPoint, NamedCount } from '@hatch-radar/shared';
import { Card } from '@hatch-radar/ui/components/card';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { FunnelBar, type FunnelStage } from '@/components/funnel-bar';
import { LoadError } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';

const RANGES: { key: BoardRange; label: string }[] = [
  { key: 'all', label: '累计' },
  { key: 'today', label: '今日' },
  { key: '7d', label: '7 天' },
  { key: '30d', label: '30 天' },
];

/** 百分比文案：分母为 0 时显「—」。 */
function pctStr(a: number, b: number): string {
  return b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—';
}
/** 成本（美元）紧凑展示。 */
function fmtCost(c: number | null): string {
  if (c == null) return '—';
  return `$${c < 1 ? c.toFixed(4) : c.toFixed(2)}`;
}

const INTENSITY: Record<string, { label: string; fill: string }> = {
  HIGH: { label: '高强度', fill: 'bg-intensity-high glow-warn' },
  MEDIUM: { label: '中强度', fill: 'bg-intensity-medium' },
  LOW: { label: '低强度', fill: 'bg-intensity-low' },
};
const INTENSITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** 版块容器（无边框分区 + 留白；标题小字灰）。 */
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

/** 同基线横条行：标签 + 轨道 + 右侧数值。 */
function BarRow({
  label,
  pct,
  fill,
  right,
  mono,
}: {
  label: ReactNode;
  pct: number;
  fill: string;
  right: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[78px_1fr_104px] items-center gap-3 py-1.5 text-xs">
      <div className={cn('truncate text-muted-foreground', mono && 'font-mono')}>{label}</div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', fill)}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="text-right font-mono tabular-nums">{right}</div>
    </div>
  );
}

/** 每日洞察趋势：flex 柱，最新一根品牌发光。 */
function TrendBars({ points }: { points: FunnelTrendPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.insights));
  const last = points.length - 1;
  const peak = points.reduce((m, p) => Math.max(m, p.insights), 0);
  return (
    <div className="flex h-40 items-end gap-1.5">
      {points.map((p, i) => (
        <div
          key={p.date}
          className="group relative flex-1"
          style={{ height: `${(p.insights / max) * 100}%` }}
          title={`${p.date} · ${p.insights} 洞察`}
        >
          <div
            className={cn(
              'h-full w-full rounded-[3px]',
              i === last ? 'bg-primary glow-primary' : 'bg-primary/35',
            )}
          />
          {i === last ? (
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-xs font-semibold tabular-nums text-primary">
              {peak >= 0 ? p.insights : ''}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function BoardView() {
  const [range, setRange] = useState<BoardRange>('all');
  const q = useQuery({
    queryKey: ['board', range],
    queryFn: () => api.get<BoardData>(`/dashboard?range=${range}`),
  });

  const header = (
    <PageHeader
      title="数据看板"
      description="雷达发现并验证了多少真实需求 · 采集 → 分析 → 洞察 → 验证（运行状况见指挥室）"
      actions={
        <div className="inline-flex gap-0.5 rounded-lg border bg-card p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium tabular-nums transition-colors',
                range === r.key
                  ? 'bg-primary text-primary-foreground glow-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    />
  );

  if (q.isError) {
    return (
      <>
        {header}
        <LoadError
          message={q.error instanceof ApiError ? q.error.message : undefined}
          onRetry={() => void q.refetch()}
        />
      </>
    );
  }
  if (q.isPending) {
    return (
      <>
        {header}
        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </>
    );
  }

  const d = q.data;
  const f = d.funnel;
  const base = Math.max(1, f.collected);
  const reservedPct = Math.max(12, (f.insights / base) * 100 * 0.6);
  const stages: FunnelStage[] = [
    {
      key: 'collected',
      name: '采集数据',
      tag: 'posts',
      value: f.collected,
      pct: 100,
      tone: 'brand',
      conv: { label: '已分析', value: pctStr(f.analyzed, f.collected) },
    },
    {
      key: 'analyzed',
      name: '分析数据',
      tag: 'analyzed',
      value: f.analyzed,
      pct: (f.analyzed / base) * 100,
      tone: 'mid',
      conv: { label: '产出洞察', value: pctStr(f.insights, f.analyzed) },
    },
    {
      key: 'insights',
      name: '洞察需求',
      tag: 'insights',
      value: f.insights,
      pct: (f.insights / base) * 100,
      tone: 'signal',
      conv: { label: '人工 / AI 验证', value: '—' },
    },
    {
      key: 'verified',
      name: '验证需求',
      value: null,
      pct: reservedPct,
      tone: 'reserved',
      note: '研判功能即将上线',
    },
  ];

  const intensity = [...d.quality.byIntensity].sort(
    (a, b) => (INTENSITY_RANK[a.name] ?? 9) - (INTENSITY_RANK[b.name] ?? 9),
  );
  const intensityTotal = intensity.reduce((s, x) => s + x.count, 0);
  const intensityMax = Math.max(1, ...intensity.map((x) => x.count));
  const srcMax = Math.max(1, ...d.sources.map((s) => s.count));
  const tagMax = Math.max(1, ...d.quality.topTags.map((t) => t.count));

  return (
    <>
      {header}
      <div className="space-y-6">
        {/* 价值漏斗（英雄区） */}
        <Card className="surface relative overflow-hidden p-6">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(90% 130% at 100% 0%, color-mix(in oklab, var(--primary) 10%, transparent), transparent 60%)',
            }}
          />
          <div className="relative">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span className="signal-pulse size-1.5 rounded-full bg-primary" />
              价值漏斗 · {RANGES.find((r) => r.key === range)?.label}
            </div>
            <FunnelBar stages={stages} />
          </div>
        </Card>

        {/* KPI 行 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="洞察需求"
            value={f.insights.toLocaleString()}
            hint={range === 'all' ? '累计产出' : '本期新增'}
            spark={d.funnelTrend.map((p) => p.insights)}
          />
          <StatCard
            label="采集 → 洞察 转化"
            value={pctStr(f.insights, f.collected)}
            hint={`${f.collected.toLocaleString()} 帖 → ${f.insights.toLocaleString()} 洞察`}
          />
          <StatCard
            label="每洞察成本 · 过渡"
            value={fmtCost(d.roi.costPerInsight)}
            hint="→ 未来每验证成本"
          />
          <StatCard label="验证需求" value="—" reserved hint="研判功能即将上线" />
        </div>

        {/* 漏斗趋势 */}
        <Section title={<>漏斗趋势 · 每日新增洞察</>}>
          <Card className="surface p-5 pt-7">
            {d.funnelTrend.some((p) => p.insights > 0) ? (
              <TrendBars points={d.funnelTrend} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                窗口内暂无新增洞察。
              </p>
            )}
          </Card>
        </Section>

        {/* 强度 + 来源 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="洞察强度分布">
            <Card className="surface p-5">
              {intensity.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无洞察。</p>
              ) : (
                intensity.map((x) => {
                  const meta = INTENSITY[x.name] ?? { label: x.name, fill: 'bg-primary' };
                  return (
                    <BarRow
                      key={x.name}
                      label={meta.label}
                      pct={(x.count / intensityMax) * 100}
                      fill={meta.fill}
                      right={
                        <>
                          {x.count.toLocaleString()}{' '}
                          <span className="text-muted-foreground">
                            {intensityTotal > 0 ? Math.round((x.count / intensityTotal) * 100) : 0}%
                          </span>
                        </>
                      }
                    />
                  );
                })
              )}
            </Card>
            <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              热门需求主题 · tags
            </div>
            <div className="flex flex-wrap gap-2">
              {d.quality.topTags.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无标签。</p>
              ) : (
                d.quality.topTags.map((t: NamedCount) => (
                  <span
                    key={t.name}
                    className="rounded-full border bg-card px-3 py-1 text-xs"
                    style={{ opacity: 0.6 + 0.4 * (t.count / tagMax) }}
                  >
                    {t.name} <span className="ml-0.5 font-mono text-primary">{t.count}</span>
                  </span>
                ))
              )}
            </div>
          </Section>

          <Section title={<>来源洞察力 · 产出 + 验证率（预留）</>}>
            <Card className="surface p-5">
              {d.sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无来源数据。</p>
              ) : (
                d.sources.map((s) => (
                  <BarRow
                    key={s.name}
                    label={s.name}
                    mono
                    pct={(s.count / srcMax) * 100}
                    fill="bg-chart-1"
                    right={
                      <>
                        {s.count.toLocaleString()}{' '}
                        <span className="text-muted-foreground">
                          · {s.verifiedRate == null ? '—' : `${Math.round(s.verifiedRate * 100)}%`}
                        </span>
                      </>
                    }
                  />
                ))
              )}
            </Card>
          </Section>
        </div>
      </div>
    </>
  );
}

/** 看板页（insights:view）：价值漏斗、洞察质量、来源洞察力、ROI。 */
export function DashboardPage() {
  return (
    <RequirePerm perm="insights:view">
      <BoardView />
    </RequirePerm>
  );
}
