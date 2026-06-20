/**
 * 运行详情（/radar/runs/:runId）—— 一条运行「此刻到底跑成什么样」+ 逐环节操控。
 *
 * 顶：运行此刻——分段进度条（完成/执行/等闸/挂闸/失败 一眼看全貌）+ 此刻在干什么
 *     （执行中的环节 / 卡在哪个 lane 的闸 / 挂闸待放行）+ 各阶段进度 + 本次收成。
 * 左：任务血缘树（discover→collect→analyze / recheck→analyze），每行**自报当前状态**
 *     （「AI 分析…」/「等 AI 闸」/「挂闸·抓评论」），活跃行高亮、计数在涨。
 * 右：选中任务的帖子卡 + 环节列表（可挂/摘闸门）+ 选中环节产物 + 控制条（真改 world）。
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowBigUp,
  ChevronRight,
  Layers,
  Lock,
  LockOpen,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Card } from '@hatch-radar/ui/components/card';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { commentAvatarDataUri } from '@/lib/avatar';
import {
  KIND_META,
  LANE_META,
  RUN_STATUS_META,
  SOURCE_META,
  STAGE_STATUS_META,
  stageLabel,
  TASK_KIND_META,
  TASK_STATUS_META,
} from './constants';
import {
  cancelTask,
  releaseStage,
  retryStage,
  runToEnd,
  toggleGate,
  useLang,
  useWorld,
} from './store';
import type { Comment, LaneId, Post, Stage, Task, TaskKind, World } from './types';
import { fmtDur, relPast, tText } from './util';

/** 任务的当前环节（first pending|running|waiting，= engine 的推进焦点）。 */
function currentStage(task: Task): Stage | undefined {
  return task.stages.find(
    (s) => s.status === 'pending' || s.status === 'running' || s.status === 'waiting',
  );
}

/** 各状态计数 —— 把 task.status==='running' 进一步拆成「执行中」vs「等闸」。 */
interface LiveCounts {
  succeeded: number;
  skipped: number;
  failed: number;
  canceled: number;
  queued: number;
  paused: number;
  /** 正在跑某个非 fetch 环节。 */
  executing: number;
  /** 跑到 fetch 环节、停在请求闸等放行。 */
  waiting: number;
}

function bump<K>(m: Map<K, number>, k: K): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function selectRun(w: World, runId: string) {
  const run = w.runs.find((r) => r.id === runId);
  if (!run) return null;
  const process = w.processes.find((p) => p.id === run.processId) ?? null;
  const blueprint = w.blueprints.find((b) => b.id === run.blueprintId) ?? null;
  const tasks = w.tasks.filter((t) => t.runId === runId);

  // 血缘树：按 parentId 展开，记深度
  const byParent = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = t.parentId ?? '__root';
    const arr = byParent.get(k);
    if (arr) arr.push(t);
    else byParent.set(k, [t]);
  }
  const tree: { task: Task; depth: number }[] = [];
  const walk = (key: string, depth: number): void => {
    const kids = (byParent.get(key) ?? []).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    for (const t of kids) {
      tree.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk('__root', 0);

  // 此刻：逐任务归并状态 + 拆出「执行哪个环节 / 卡哪个 lane / 挂哪个闸」
  const counts: LiveCounts = {
    succeeded: 0,
    skipped: 0,
    failed: 0,
    canceled: 0,
    queued: 0,
    paused: 0,
    executing: 0,
    waiting: 0,
  };
  const runningByStage = new Map<string, number>();
  const waitingByLane = new Map<LaneId, number>();
  const pausedByStage = new Map<string, number>();
  for (const t of tasks) {
    switch (t.status) {
      case 'succeeded':
        counts.succeeded += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'canceled':
        counts.canceled += 1;
        break;
      case 'queued':
        counts.queued += 1;
        break;
      case 'paused': {
        counts.paused += 1;
        const g = t.stages.find((s) => s.status === 'pending' && s.gate);
        if (g) bump(pausedByStage, stageLabel(g.name));
        break;
      }
      case 'running': {
        const cur = currentStage(t);
        if (cur?.status === 'waiting') {
          counts.waiting += 1;
          if (cur.lane) bump(waitingByLane, cur.lane);
        } else {
          counts.executing += 1;
          if (cur) bump(runningByStage, stageLabel(cur.name));
        }
        break;
      }
    }
  }

  const total = tasks.length;
  const done = counts.succeeded + counts.skipped;
  const inflight = counts.executing + counts.waiting + counts.paused + counts.queued;

  // 各阶段进度（按 task kind；只列存在的阶段）
  const phaseOrder: TaskKind[] =
    run.kind === 'collect' ? ['discover', 'collect', 'analyze'] : ['recheck', 'analyze'];
  const phases = phaseOrder
    .map((kind) => {
      const ts = tasks.filter((t) => t.kind === kind);
      return {
        kind,
        total: ts.length,
        done: ts.filter((t) => t.status === 'succeeded' || t.status === 'skipped').length,
      };
    })
    .filter((p) => p.total > 0);

  const elapsed =
    (run.status === 'running' ? w.nowMs : (run.finishedAt ?? w.nowMs)) - run.startedAt;
  const insights = w.insights.filter((i) => i.runId === runId).length;

  return {
    run,
    process,
    blueprint,
    tree,
    total,
    done,
    counts,
    runningByStage: [...runningByStage],
    waitingByLane: [...waitingByLane],
    pausedByStage: [...pausedByStage],
    phases,
    elapsed,
    inflight,
    insights,
    nowMs: w.nowMs,
  };
}

type RunData = NonNullable<ReturnType<typeof selectRun>>;

// ─── 运行此刻：概览带 ───────────────────────────────────────────────────────────

/** 分段进度条：完成 | 略过 | 执行 | 等闸 | 挂闸 | 失败，余下空白 = 排队/待执行。 */
function StatusBar({ counts, total }: { counts: LiveCounts; total: number }) {
  if (total === 0) return <div className="h-2 rounded-full bg-muted" />;
  const seg = (n: number, cls: string, key: string) =>
    n > 0 ? <div key={key} className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-muted">
      {seg(counts.succeeded, 'bg-muted-foreground', 's')}
      {seg(counts.skipped, 'bg-muted-foreground/40', 'k')}
      {seg(counts.executing, 'bg-primary', 'e')}
      {seg(counts.waiting, 'bg-intensity-medium', 'w')}
      {seg(counts.paused, 'bg-intensity-medium/60', 'p')}
      {seg(counts.failed, 'bg-intensity-high', 'f')}
    </div>
  );
}

function PhaseMini({ phase }: { phase: RunData['phases'][number] }) {
  const meta = TASK_KIND_META[phase.kind];
  const pct = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : 0;
  return (
    <div className="min-w-[7rem] flex-1 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <meta.icon className={cn('size-3', meta.color)} />
          {meta.label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {phase.done}/{phase.total}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function joinGroups(groups: [string, number][]): string {
  return groups.map(([k, v]) => `${k}×${v}`).join('、');
}
function joinLanes(lanes: [LaneId, number][]): string {
  return lanes.map(([id, v]) => `${LANE_META[id].label}×${v}`).join('、');
}

function RunOverview({ data }: { data: RunData }) {
  const {
    run,
    total,
    done,
    counts,
    runningByStage,
    waitingByLane,
    pausedByStage,
    phases,
    elapsed,
    inflight,
    insights,
  } = data;
  const isRunning = run.status === 'running';
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const hasLive = counts.executing + counts.waiting + counts.paused + counts.queued > 0;

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Activity
            className={cn('size-4', isRunning ? 'text-primary' : 'text-muted-foreground')}
          />
          {isRunning ? '运行此刻' : '运行结果'}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {isRunning ? '已跑' : '耗时'} {fmtDur(elapsed)}
          {isRunning && inflight > 0 ? ` · 在途 ${inflight}` : ''}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm tabular-nums">
            <span className="font-semibold">{done}</span>
            <span className="text-muted-foreground">/{total} 任务</span>
          </span>
          <span className="text-sm tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <StatusBar counts={counts} total={total} />
      </div>

      {/* 此刻在干什么：执行中（哪个环节）· 等闸（卡哪个 lane）· 挂闸待放行 · 排队，再接已结算的盘点 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {isRunning && hasLive ? (
          <>
            {counts.executing > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-primary signal-pulse" />
                <span className="font-medium text-foreground">执行中 {counts.executing}</span>
                {runningByStage.length > 0 ? (
                  <span className="text-muted-foreground">· {joinGroups(runningByStage)}</span>
                ) : null}
              </span>
            ) : null}
            {counts.waiting > 0 ? (
              <Link
                to="/radar/requests"
                className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
              >
                <span className="size-1.5 rounded-full bg-intensity-medium" />
                <span className="font-medium text-intensity-medium">等闸 {counts.waiting}</span>
                <span className="text-muted-foreground">· {joinLanes(waitingByLane)} →</span>
              </Link>
            ) : null}
            {counts.paused > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-intensity-medium/60" />
                <span className="font-medium text-intensity-medium">挂闸 {counts.paused}</span>
                {pausedByStage.length > 0 ? (
                  <span className="text-muted-foreground">· {joinGroups(pausedByStage)}</span>
                ) : null}
              </span>
            ) : null}
            {counts.queued > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                排队 {counts.queued}
              </span>
            ) : null}
            <span className="text-muted-foreground/30">·</span>
          </>
        ) : null}
        <span className="tabular-nums text-muted-foreground">完成 {counts.succeeded}</span>
        {counts.skipped > 0 ? (
          <span className="tabular-nums text-muted-foreground">略过 {counts.skipped}</span>
        ) : null}
        {counts.failed > 0 ? (
          <span className="tabular-nums text-destructive">失败 {counts.failed}</span>
        ) : null}
        {counts.canceled > 0 ? (
          <span className="tabular-nums text-muted-foreground">取消 {counts.canceled}</span>
        ) : null}
      </div>

      {phases.length > 0 ? (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-3">
          {phases.map((p) => (
            <PhaseMini key={p.kind} phase={p} />
          ))}
        </div>
      ) : null}

      {insights > 0 ? (
        <Link
          to="/radar/insights"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Sparkles className="size-3.5 text-intensity-high" />
          本次已收成 <span className="font-medium tabular-nums text-foreground">
            {insights}
          </span>{' '}
          条洞察
          <ChevronRight className="size-3.5" />
        </Link>
      ) : null}
    </Card>
  );
}

// ─── 任务树行 ──────────────────────────────────────────────────────────────────

function StageDots({ stages }: { stages: Stage[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {stages.map((s) => (
        <span
          key={s.seq}
          className={cn('size-1.5 rounded-full', STAGE_STATUS_META[s.status].dot)}
          title={`${stageLabel(s.name)} · ${STAGE_STATUS_META[s.status].label}`}
        />
      ))}
    </span>
  );
}

type Tone = 'primary' | 'amber' | 'red' | 'done' | 'muted';
const TONE: Record<Tone, { text: string; dot: string; tint: string }> = {
  primary: { text: 'text-primary', dot: 'bg-primary', tint: 'bg-primary/5' },
  amber: {
    text: 'text-intensity-medium',
    dot: 'bg-intensity-medium',
    tint: 'bg-intensity-medium/10',
  },
  red: { text: 'text-destructive', dot: 'bg-intensity-high', tint: 'bg-destructive/5' },
  done: { text: 'text-muted-foreground', dot: 'bg-muted-foreground', tint: '' },
  muted: { text: 'text-muted-foreground/70', dot: 'bg-muted-foreground/30', tint: '' },
};

/** 一行任务此刻在干什么（自报家门，免去逐个点开）。 */
function liveState(task: Task): { tone: Tone; label: string } {
  switch (task.status) {
    case 'paused': {
      const g = task.stages.find((s) => s.status === 'pending' && s.gate);
      return { tone: 'amber', label: g ? `挂闸·${stageLabel(g.name)}` : '挂闸待放行' };
    }
    case 'failed': {
      const f = task.stages.find((s) => s.status === 'failed');
      return { tone: 'red', label: f ? `失败·${stageLabel(f.name)}` : '失败' };
    }
    case 'running': {
      const cur = currentStage(task);
      if (cur?.status === 'waiting')
        return { tone: 'amber', label: `等 ${cur.lane ? LANE_META[cur.lane].label : ''} 闸` };
      if (cur?.status === 'running') return { tone: 'primary', label: `${stageLabel(cur.name)}…` };
      return { tone: 'primary', label: '运行中' };
    }
    case 'queued':
      return { tone: 'muted', label: '排队' };
    case 'succeeded':
      return {
        tone: 'done',
        label:
          task.startedAt && task.finishedAt
            ? `完成·${fmtDur(task.finishedAt - task.startedAt)}`
            : '完成',
      };
    case 'skipped':
      return { tone: 'done', label: '略过' };
    default:
      return { tone: 'muted', label: '取消' };
  }
}

function TaskRow({
  task,
  depth,
  selected,
  onSelect,
}: {
  task: Task;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = TASK_KIND_META[task.kind];
  const Icon = meta.icon;
  const live = liveState(task);
  const tone = TONE[live.tone];
  const preferOriginal = useLang();
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-accent',
        selected ? 'bg-accent' : tone.tint,
      )}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          live.tone === 'primary' && task.status === 'running' && 'signal-pulse',
          tone.dot,
        )}
      />
      <Icon className={cn('size-4 shrink-0', meta.color)} />
      <span className="shrink-0 font-medium">{meta.label}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {task.post
          ? tText(task.post.title, task.post.titleZh, preferOriginal)
          : '列表发现 + 去重 + 派生'}
      </span>
      <StageDots stages={task.stages} />
      <span
        className={cn('w-24 shrink-0 truncate text-right text-xs tabular-nums', tone.text)}
        title={live.label}
      >
        {live.label}
      </span>
    </button>
  );
}

// ─── 帖子卡 + 评论树 ───────────────────────────────────────────────────────────

function CommentNode({ c }: { c: Comment }) {
  const preferOriginal = useLang();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        <img
          src={commentAvatarDataUri(c.author)}
          alt=""
          aria-hidden
          className="size-4 shrink-0 rounded-full bg-muted"
        />
        <span className="font-medium text-foreground">u/{c.author}</span>
        <span className="text-muted-foreground">· ↑{c.score}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {tText(c.body, c.bodyZh, preferOriginal)}
      </p>
      {c.children && c.children.length > 0 ? (
        <div className="mt-1.5 space-y-2 border-l pl-2.5">
          {c.children.map((ch, i) => (
            <CommentNode key={i} c={ch} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PostCard({ post, nowMs }: { post: Post; nowMs: number }) {
  const Icon = SOURCE_META[post.source].icon;
  const preferOriginal = useLang();
  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <Icon className="size-3.5" />
          {post.channel}
        </span>
        <span className="ml-auto">{relPast(nowMs - post.ageMinutes * 60_000, nowMs)}</span>
      </div>
      <p className="text-sm leading-snug font-medium">
        {tText(post.title, post.titleZh, preferOriginal)}
      </p>
      {post.body ? (
        <p className="max-h-32 overflow-y-auto text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
          {tText(post.body, post.bodyZh, preferOriginal)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/60">链接帖 · 无正文</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>u/{post.author}</span>
        <span className="inline-flex items-center gap-0.5">
          <ArrowBigUp className="size-3.5" />
          {post.score.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" />
          {post.numComments}
        </span>
        {post.commentDepth > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Layers className="size-3" />
            最深 {post.commentDepth} 层
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── 选中任务面板 ───────────────────────────────────────────────────────────────

function controlsFor(task: Task): { label: string; primary?: boolean; run: () => void }[] {
  if (task.status === 'paused')
    return [
      { label: '放行下一步', primary: true, run: () => releaseStage(task.id) },
      { label: '运行到底', run: () => runToEnd(task.id) },
      { label: '取消', run: () => cancelTask(task.id) },
    ];
  if (task.status === 'failed')
    return [
      { label: '重试本环节', primary: true, run: () => retryStage(task.id) },
      { label: '取消', run: () => cancelTask(task.id) },
    ];
  if (task.status === 'running' || task.status === 'queued')
    return [{ label: '取消', run: () => cancelTask(task.id) }];
  return [];
}

function TaskPanel({ task, nowMs }: { task: Task; nowMs: number }) {
  const [seq, setSeq] = useState<number | null>(null);
  const meta = TASK_STATUS_META[task.status];
  const kindMeta = TASK_KIND_META[task.kind];
  const stage = seq != null ? task.stages.find((s) => s.seq === seq) : undefined;
  const isComments = stage != null && (stage.name === 'fetch_comments' || stage.name === 'recrawl');
  const controls = controlsFor(task);

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <kindMeta.icon className={cn('size-4', kindMeta.color)} />
        <span className="text-sm font-medium">{kindMeta.label}</span>
        {task.post ? (
          <span className="font-mono text-xs text-muted-foreground">{task.post.id}</span>
        ) : null}
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      {task.post ? (
        <div className="space-y-1.5">
          <PostCard post={task.post} nowMs={nowMs} />
          <Link
            to={`/radar/posts/${task.post.id}`}
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            看这帖一生 →
          </Link>
        </div>
      ) : null}

      <div>
        <div className="mb-1 text-xs text-muted-foreground">环节（点闸门图标可挂/摘）</div>
        <div className="space-y-0.5">
          {task.stages.map((s) => {
            const canGate = s.status === 'pending';
            return (
              <div
                key={s.seq}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                  seq === s.seq ? 'bg-accent' : '',
                )}
              >
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    s.status === 'running' && 'signal-pulse',
                    STAGE_STATUS_META[s.status].dot,
                  )}
                />
                <button
                  type="button"
                  onClick={() => setSeq(s.seq)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="shrink-0">{stageLabel(s.name)}</span>
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/60">
                    {s.name}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!canGate}
                  onClick={() => toggleGate(task.id, s.seq)}
                  aria-label={s.gate ? '摘闸门' : '挂闸门'}
                  className={cn(
                    'shrink-0',
                    canGate ? 'hover:text-foreground' : 'cursor-default opacity-40',
                  )}
                >
                  {s.gate ? (
                    <Lock className="size-3.5 text-intensity-medium" />
                  ) : (
                    <LockOpen className="size-3.5 text-muted-foreground/50" />
                  )}
                </button>
                <span className="w-12 shrink-0 text-right text-muted-foreground">
                  {STAGE_STATUS_META[s.status].label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {stage ? (
        <div className="rounded-md border bg-background p-3 text-sm">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            产物 · <span className="text-foreground">{stageLabel(stage.name)}</span>
            {stage.name === 'ai_call' ? (
              <span className="text-intensity-high">· 不可重算</span>
            ) : null}
          </div>
          {stage.error ? (
            <p className="text-destructive">{stage.error}</p>
          ) : isComments && task.post && task.post.comments.length > 0 ? (
            <div className="space-y-2 border-l pl-2.5">
              {task.post.comments.map((c, i) => (
                <CommentNode key={i} c={c} />
              ))}
            </div>
          ) : stage.output ? (
            <p className="text-muted-foreground">{stage.output}</p>
          ) : (
            <p className="text-muted-foreground/70">尚未产出（环节未执行）。</p>
          )}
        </div>
      ) : null}

      {controls.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {controls.map((c) => (
            <Button
              key={c.label}
              size="sm"
              variant={c.primary ? 'default' : 'outline'}
              onClick={c.run}
            >
              {c.label}
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

// ─── 页面 ──────────────────────────────────────────────────────────────────────

function RunDetailView() {
  const { runId = '' } = useParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const data = useWorld((w) => selectRun(w, runId));

  if (!data) return <EmptyState title="运行不存在" hint="它可能已被清理。返回指挥室看看。" />;
  const { run, process, blueprint, tree, nowMs } = data;
  const selected = selectedId ? (tree.find((n) => n.task.id === selectedId)?.task ?? null) : null;
  const rm = RUN_STATUS_META[run.status];

  return (
    <>
      <PageHeader
        title={`运行 · ${process?.label ?? run.processId}`}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Badge variant={rm.variant}>{rm.label}</Badge>
            {blueprint ? (
              <span className="text-muted-foreground">
                {KIND_META[blueprint.kind].label} · {blueprint.label}
              </span>
            ) : null}
            {run.sweepSeq != null ? (
              <span className="text-muted-foreground">sweep #{run.sweepSeq}</span>
            ) : null}
            <span className="text-muted-foreground">· {relPast(run.startedAt, nowMs)}起</span>
          </span>
        }
      />

      <div className="space-y-4">
        <RunOverview data={data} />

        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          <Card className="p-2">
            {tree.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">任务派生中…</p>
            ) : (
              tree.map(({ task, depth }) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  depth={depth}
                  selected={selectedId === task.id}
                  onSelect={() => setSelectedId(task.id)}
                />
              ))
            )}
          </Card>
          <div className="lg:sticky lg:top-4 lg:self-start">
            {selected ? (
              <TaskPanel task={selected} nowMs={nowMs} />
            ) : (
              <Card className="p-6">
                <p className="text-sm text-muted-foreground">
                  点左侧某个任务，查看它的帖子、逐环节产物与控制。
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function RadarRunDetailPage() {
  return (
    <RequirePerm perm="analyze:run">
      <RunDetailView />
    </RequirePerm>
  );
}
