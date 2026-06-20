/**
 * 帖子库 · 一生（/radar/posts）—— P4：把「帖子的跨运行一生」与「复查自适应退避」画出来。
 *
 * 顶部退避分布（活跃多查 / 沉默渐疏，本轮到期几何）；左列帖子（含复查状态）；
 * 右侧选中帖的「一生」时间线：采集 → 历次复查（有变/未变退避）→ 重分析 → 洞察，全由 world.tasks 派生。
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowBigUp, MessageSquare } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Card } from '@hatch-radar/ui/components/card';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { ClockBar } from './clock-bar';
import { INTENSITY_META, SOURCE_META, TASK_STATUS_META } from './constants';
import { useWorld } from './store';
import type { Insight, Post, Task, World } from './types';
import { relPast } from './util';

const CAP = 16;

function recheckSweepOf(w: World): number {
  return w.processes.reduce((mx, p) => {
    const b = w.blueprints.find((x) => x.id === p.blueprintId);
    return b?.kind === 'recheck' ? Math.max(mx, p.sweepSeq) : mx;
  }, 0);
}

function intervalLabel(misses: number): string {
  if (misses <= 0) return '每轮查';
  return `隔 ${Math.min(2 ** (misses - 1), CAP)} 轮`;
}

function eventLabel(task: Task, sweep: number | null): string {
  if (task.kind === 'collect') return '采集入库';
  if (task.kind === 'analyze') {
    if (task.status === 'failed') return 'AI 分析失败';
    if (task.status === 'succeeded') return 'AI 分析 → 产出洞察';
    return 'AI 分析中';
  }
  if (task.kind === 'recheck') {
    const s = sweep != null ? `复查 #${sweep}` : '复查';
    if (task.status === 'skipped') return `${s} · 未变化（退避）`;
    if (task.status === 'succeeded') return `${s} · 有变化 → 重抓`;
    if (task.status === 'failed') return `${s} · 失败`;
    return `${s} · 进行中`;
  }
  return task.kind;
}

interface LifeDetail {
  post: Post;
  events: { task: Task; sweep: number | null; at: number }[];
  insights: Insight[];
  misses: number;
  due: number;
}

function select(w: World, selectedId: string | null) {
  const sweep = recheckSweepOf(w);
  const rows = w.posts
    .map((p) => ({
      post: p,
      misses: p.recheckMisses ?? 0,
      due: p.recheckDueSweep ?? 0,
      dueNow: (p.recheckDueSweep ?? 0) <= sweep,
    }))
    .sort((a, b) => a.misses - b.misses || b.post.score - a.post.score);

  const dist = [0, 1, 2, 3, 4].map((l) => ({
    level: l,
    count: rows.filter((r) => (l === 4 ? r.misses >= 4 : r.misses === l)).length,
    label: l === 0 ? '活跃' : l === 4 ? '连未变 4+' : `连未变 ${l}`,
    interval: l === 0 ? '每轮查' : `隔 ${Math.min(2 ** (l - 1), CAP)} 轮`,
  }));
  const dueNow = rows.filter((r) => r.dueNow).length;

  const effectiveId = selectedId ?? rows[0]?.post.id ?? null;
  let detail: LifeDetail | null = null;
  const post = effectiveId ? w.posts.find((p) => p.id === effectiveId) : undefined;
  if (post) {
    const events = w.tasks
      .filter((t) => t.postId === post.id)
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt)
      .map((t) => ({
        task: t,
        sweep: w.runs.find((r) => r.id === t.runId)?.sweepSeq ?? null,
        at: t.finishedAt ?? t.enqueuedAt,
      }));
    const insights = w.insights.filter((i) => i.postId === post.id);
    detail = { post, events, insights, misses: post.recheckMisses ?? 0, due: post.recheckDueSweep ?? 0 };
  }

  return { rows, dist, dueNow, sweep, total: rows.length, detail, effectiveId, nowMs: w.nowMs };
}

type Data = ReturnType<typeof select>;

function BackoffCard({ d }: { d: Data }) {
  const max = Math.max(1, ...d.dist.map((x) => x.count));
  return (
    <Card className="gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">复查退避分布</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          当前 sweep #{d.sweep} · 本轮到期 {d.dueNow}/{d.total}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        活跃帖每轮查、连续未变的帖按 1→2→4→…→{CAP} 轮指数退避——沉默越久查得越疏，一旦再活跃即复位。
      </p>
      <div className="mt-1 space-y-1.5">
        {d.dist.map((x) => (
          <div key={x.level} className="flex items-center gap-3 text-sm">
            <span className="w-20 shrink-0 text-muted-foreground">{x.label}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full', x.level === 0 ? 'bg-signal' : 'bg-primary')}
                style={{ width: `${(x.count / max) * 100}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {x.count} 帖 · {x.interval}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Lifecycle({ d, nowMs }: { d: LifeDetail; nowMs: number }) {
  const post = d.post;
  const SrcIcon = SOURCE_META[post.source].icon;
  return (
    <Card className="gap-4 p-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <SrcIcon className="size-3.5" />
            {post.channel}
          </span>
          <span className="font-mono">{post.id}</span>
          <span className="ml-auto inline-flex items-center gap-2 tabular-nums">
            <span className="inline-flex items-center gap-0.5">
              <ArrowBigUp className="size-3.5" />
              {post.score.toLocaleString()}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" />
              {post.numComments}
            </span>
          </span>
        </div>
        <p className="text-sm leading-snug font-medium">{post.title}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2.5 text-xs">
        <Badge variant={d.misses === 0 ? 'default' : 'secondary'}>
          {d.misses === 0 ? '活跃' : `连续未变 ${d.misses} 次`}
        </Badge>
        <span className="text-muted-foreground">复查节奏 {intervalLabel(d.misses)}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">下次到期 sweep #{d.due}</span>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">一生时间线（跨运行）</div>
        {d.events.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">暂无事件。</p>
        ) : (
          d.events.map(({ task, sweep, at }, i) => (
            <div key={task.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', TASK_STATUS_META[task.status].dot)} />
                {i < d.events.length - 1 ? <span className="my-0.5 w-px flex-1 bg-border" /> : null}
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pb-3 text-sm">
                <Link to={`/radar/runs/${task.runId}`} className="min-w-0 truncate hover:text-primary">
                  {eventLabel(task, sweep)}
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relPast(at, nowMs)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {d.insights.length > 0 ? (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">产出洞察（{d.insights.length}）</div>
          <div className="space-y-1.5">
            {d.insights.map((ins) => (
              <Link
                key={ins.id}
                to={`/radar/runs/${ins.runId}`}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', INTENSITY_META[ins.intensity].bar)} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{ins.painPoint}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground/70">
                  痛 {ins.painCount} · 机 {ins.oppCount}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function PostsView() {
  const { id } = useParams();
  const [selectedId, setSelectedId] = useState<string | null>(id ?? null);
  const d = useWorld((w) => select(w, selectedId));

  return (
    <>
      <PageHeader
        title="帖子库 · 一生"
        description="每条帖子的跨运行一生 + 复查自适应退避——活跃多查、沉默渐疏、再活跃即复位。"
        actions={<ClockBar />}
      />
      <div className="space-y-5">
        <BackoffCard d={d} />
        {d.rows.length === 0 ? (
          <EmptyState title="还没有帖子" hint="等采集跑起来，入库的帖会出现在这里。" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
            <div className="space-y-1.5">
              {d.rows.map(({ post, misses, dueNow }) => {
                const SrcIcon = SOURCE_META[post.source].icon;
                const active = d.effectiveId === post.id;
                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => setSelectedId(post.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors',
                      active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                    )}
                  >
                    <SrcIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-xs leading-snug font-medium">{post.title}</span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className={cn(misses === 0 && 'text-signal')}>
                          {misses === 0 ? '活跃' : `连未变 ${misses}`}
                        </span>
                        <span>·</span>
                        <span>{intervalLabel(misses)}</span>
                        {dueNow ? <span className="text-intensity-medium">· 到期</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {d.detail ? <Lifecycle d={d.detail} nowMs={d.nowMs} /> : null}
          </div>
        )}
      </div>
    </>
  );
}

export function PostsPage() {
  return (
    <RequirePerm perm="analyze:run">
      <PostsView />
    </RequirePerm>
  );
}
