/**
 * 收成 · 洞察（/radar/insights）—— 闭环的回点。
 *
 * 这台雷达「挖出了什么」：分析产出的洞察，**可溯源回产它的进程 / 运行 / 帖子**；
 * 并按进程聚合「谁在产出价值」——产出反哺定义，闭环才真正合上。
 */
import { useNavigate } from 'react-router-dom';
import { Lightbulb, Sparkles } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Card } from '@hatch-radar/ui/components/card';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { ClockBar } from './clock-bar';
import { INTENSITY_META, SOURCE_META } from './constants';
import { useWorld } from './store';
import type { Insight, World } from './types';
import { relPast } from './util';

function selectHarvest(w: World) {
  const procLabel = (pid: string): string => w.processes.find((p) => p.id === pid)?.label ?? pid;
  const sorted = [...w.insights].sort((a, b) => b.createdAt - a.createdAt);
  const byIntensity = { high: 0, medium: 0, low: 0 };
  for (const i of sorted) byIntensity[i.intensity] += 1;
  const byProc = new Map<string, number>();
  for (const i of sorted) byProc.set(i.processId, (byProc.get(i.processId) ?? 0) + 1);
  const procStats = [...byProc.entries()]
    .map(([pid, count]) => ({ pid, label: procLabel(pid), count }))
    .sort((a, b) => b.count - a.count);
  const insights = sorted.slice(0, 40).map((i) => ({ ...i, procLabel: procLabel(i.processId) }));
  return { insights, total: sorted.length, byIntensity, procStats, nowMs: w.nowMs };
}

function InsightRow({
  insight,
  nowMs,
}: {
  insight: Insight & { procLabel: string };
  nowMs: number;
}) {
  const navigate = useNavigate();
  const im = INTENSITY_META[insight.intensity];
  const sm = SOURCE_META[insight.source];
  return (
    <Card
      className="relative cursor-pointer gap-2 overflow-hidden py-3 transition-colors hover:bg-accent/40"
      onClick={() => navigate(`/radar/runs/${insight.runId}`)}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', im.bar)} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 text-xs text-muted-foreground">
        <Badge variant="outline" className={cn('gap-1', im.text)}>
          强度 {im.label}
        </Badge>
        <span className="inline-flex items-center gap-1">
          <sm.icon className="size-3.5" />
          {insight.channel}
        </span>
        <span className="inline-flex items-center gap-1">
          产自 <span className="font-medium text-foreground">{insight.procLabel}</span>
        </span>
        <span className="ml-auto tabular-nums">{relPast(insight.createdAt, nowMs)}</span>
      </div>
      <p className="px-4 text-[15px] leading-snug font-medium">{insight.postTitle}</p>
      <p className="line-clamp-2 px-4 text-sm text-muted-foreground">{insight.painPoint}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4">
        {insight.tags.slice(0, 5).map((t) => (
          <Badge key={t} variant="secondary" className="font-normal">
            {t}
          </Badge>
        ))}
        <span className="ml-auto inline-flex items-center gap-3 text-xs tabular-nums whitespace-nowrap text-muted-foreground">
          <span>痛点 <span className="font-medium text-foreground">{insight.painCount}</span></span>
          <span>机会 <span className="font-medium text-foreground">{insight.oppCount}</span></span>
        </span>
      </div>
    </Card>
  );
}

function Harvest() {
  const d = useWorld(selectHarvest);
  return (
    <>
      <PageHeader
        title="收成 · 洞察"
        description="这台雷达挖出了什么——分析产出的洞察，可溯源回产它的进程 / 运行 / 帖子。"
        actions={<ClockBar />}
      />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="洞察总数" value={d.total} icon={Sparkles} hint="本会话累计产出" />
          <StatCard label="强信号" value={d.byIntensity.high} icon={Lightbulb} hint="高强度洞察" />
          <StatCard label="中信号" value={d.byIntensity.medium} icon={Lightbulb} hint="中强度" />
          <StatCard label="弱信号" value={d.byIntensity.low} icon={Lightbulb} hint="低强度" />
        </div>

        {d.procStats.length > 0 ? (
          <Card className="gap-2 p-4">
            <h2 className="text-sm font-semibold">谁在产出价值（按进程）</h2>
            <div className="space-y-1.5">
              {d.procStats.map((s) => {
                const pct = d.total > 0 ? Math.round((s.count / d.total) * 100) : 0;
                return (
                  <div key={s.pid} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0 truncate text-muted-foreground">{s.label}</span>
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {s.count} · {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}

        {d.insights.length === 0 ? (
          <EmptyState title="还没有洞察" hint="等采集 / 分析跑起来，产出会陆续出现在这里。" />
        ) : (
          <div className="space-y-2">
            {d.insights.map((i) => (
              <InsightRow key={i.id} insight={i} nowMs={d.nowMs} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function HarvestPage() {
  return (
    <RequirePerm perm="analyze:run">
      <Harvest />
    </RequirePerm>
  );
}
