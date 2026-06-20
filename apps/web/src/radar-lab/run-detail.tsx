/**
 * 运行详情（/radar/runs/:runId）—— 以「帖子」为中心看一次运行，兼顾看懂全貌与下场操控。
 *
 * 顶：运行此刻/结果——一句人话总结 + 发现/采集/分析/洞察四数 + 按帖状态分段进度条 + 此刻图例。
 * 中：发现入口行（采集运行）——扫描列表 → 去重 → 派生采集。
 * 主体：一帖一行。横向语义管线（采集：抓取→评论→分析→洞察 / 复查：探测→比对→重抓→分析→洞察），
 *      同一帖的采集 + 分析按 `analyze.parentId` 合并成一行（不再交替重复）；行尾直接给产出（强度 +
 *      痛点）或当前状态（分析中 / 等闸 / 失败 / 无变化已退避）。
 * 点行就地展开：帖子卡 + 逐环节（两 task 的环节拼接，可挂/摘闸 + 看产物）+ 操控条
 *      （放行下一步 = 单步 / 运行到底 / 重试 / 取消），真改 world。
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowBigUp,
  ChevronDown,
  Layers,
  Lock,
  LockOpen,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Card } from '@hatch-radar/ui/components/card';
import { cn } from '@hatch-radar/ui/lib/utils';
import { RequirePerm } from '@/auth/require-perm';
import { EmptyState } from '@/components/empty';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { commentAvatarDataUri } from '@/lib/avatar';
import {
  INTENSITY_META,
  KIND_META,
  LANE_META,
  RUN_STATUS_META,
  SOURCE_META,
  STAGE_STATUS_META,
  stageLabel,
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
import type { Comment, Insight, Intensity, Post, SourceKind, Stage, Task, World } from './types';
import { fmtDur, relPast, tText } from './util';

const TERMINAL: Task['status'][] = ['succeeded', 'skipped', 'failed', 'canceled'];

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_SIZE = 20;

/** 帖子按状态归到三类，供列表筛选页签。 */
type RowCat = 'running' | 'done' | 'failed';
const STATUS_TABS: { key: '' | RowCat; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'running', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' },
];

/** 任务的当前环节（first pending|running|waiting，= engine 的推进焦点）。 */
function currentStage(task: Task): Stage | undefined {
  return task.stages.find(
    (s) => s.status === 'pending' || s.status === 'running' || s.status === 'waiting',
  );
}

// ─── 管线段（概览：一帖流经的语义阶段） ─────────────────────────────────────────

type SegStatus = 'done' | 'running' | 'waiting' | 'gate' | 'failed' | 'skipped' | 'todo';

interface Seg {
  key: string;
  label: string;
  /** 产出段（done 时高亮为信号色，代表「出了洞察」）。 */
  payoff?: boolean;
  status: SegStatus;
}

const SEG_DOT: Record<SegStatus, string> = {
  done: 'bg-muted-foreground',
  running: 'bg-primary signal-pulse',
  waiting: 'bg-intensity-medium',
  gate: 'bg-intensity-medium',
  failed: 'bg-intensity-high',
  skipped: 'bg-muted-foreground/25',
  todo: 'border border-muted-foreground/30',
};
const SEG_TEXT: Record<SegStatus, string> = {
  done: 'text-muted-foreground',
  running: 'text-primary',
  waiting: 'text-intensity-medium',
  gate: 'text-intensity-medium',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground/50',
  todo: 'text-muted-foreground/50',
};

function pick(task: Task | undefined, names: string[]): Stage[] {
  return task ? task.stages.filter((s) => names.includes(s.name)) : [];
}

/** 段状态 = 覆盖环节的归并（活跃态优先于完成态）。 */
function segStatusOf(stages: Stage[], task: Task | undefined): SegStatus {
  if (!task || stages.length === 0) return 'todo';
  if (stages.some((s) => s.status === 'failed')) return 'failed';
  if (stages.some((s) => s.status === 'running')) return 'running';
  if (stages.some((s) => s.status === 'waiting')) return 'waiting';
  if (task.status === 'paused' && stages.some((s) => s.status === 'pending' && s.gate))
    return 'gate';
  if (stages.every((s) => s.status === 'done' || s.status === 'skipped'))
    return stages.some((s) => s.status === 'done') ? 'done' : 'skipped';
  return 'todo';
}

const ANALYZE_PREP = ['resolve', 'fetch', 'context', 'ai_call', 'normalize'];

function buildSegments(main: Task, analyze: Task | undefined): Seg[] {
  if (main.kind === 'collect') {
    return [
      { key: 'fetch', label: '抓取', status: segStatusOf(pick(main, ['fetch_detail']), main) },
      {
        key: 'comments',
        label: '评论',
        status: segStatusOf(pick(main, ['fetch_comments', 'persist']), main),
      },
      { key: 'analyze', label: '分析', status: segStatusOf(pick(analyze, ANALYZE_PREP), analyze) },
      {
        key: 'insight',
        label: '洞察',
        payoff: true,
        status: segStatusOf(pick(analyze, ['persist']), analyze),
      },
    ];
  }
  // recheck：detect 判无变化 → 余环节 skipped、不派生 analyze
  const noChange = main.status === 'skipped';
  const aStatus = (names: string[]): SegStatus =>
    analyze ? segStatusOf(pick(analyze, names), analyze) : noChange ? 'skipped' : 'todo';
  return [
    { key: 'probe', label: '探测', status: segStatusOf(pick(main, ['probe']), main) },
    { key: 'detect', label: '比对', status: segStatusOf(pick(main, ['detect']), main) },
    {
      key: 'recrawl',
      label: '重抓',
      status: segStatusOf(pick(main, ['recrawl', 'persist']), main),
    },
    { key: 'analyze', label: '分析', status: aStatus(ANALYZE_PREP) },
    { key: 'insight', label: '洞察', payoff: true, status: aStatus(['persist']) },
  ];
}

// ─── 帖子行模型 ─────────────────────────────────────────────────────────────────

type RowTone = 'insight' | 'run' | 'wait' | 'gate' | 'fail' | 'muted';

const ROW_TONE: Record<RowTone, string> = {
  insight: 'text-foreground',
  run: 'text-primary',
  wait: 'text-intensity-medium',
  gate: 'text-intensity-medium',
  fail: 'text-destructive',
  muted: 'text-muted-foreground',
};

interface RowModel {
  key: string;
  kind: Task['kind'];
  source: SourceKind | null;
  title: string;
  titleZh?: string;
  post: Post | null;
  segments: Seg[];
  /** 展开后逐环节按 task 分组（发现 / 采集|复查 / 分析）。 */
  groups: { label: string; task: Task }[];
  /** 操控对象 = 当前活跃的那个 task（都终态则取链尾）。 */
  activeTask: Task | null;
  insight?: Insight;
  rowTone: RowTone;
  rowLabel: string;
  /** 状态归类，用于列表筛选。 */
  cat: RowCat;
}

function activeOf(chain: Task[]): Task | null {
  return chain.find((t) => !TERMINAL.includes(t.status)) ?? chain[chain.length - 1] ?? null;
}

function rowStateOf(
  active: Task | null,
  insight: Insight | undefined,
  main: Task,
): { tone: RowTone; label: string } {
  if (insight) return { tone: 'insight', label: insight.painPoint };
  if (!active) return { tone: 'muted', label: '—' };
  switch (active.status) {
    case 'paused': {
      const g = active.stages.find((s) => s.status === 'pending' && s.gate);
      return { tone: 'gate', label: g ? `挂在「${stageLabel(g.name)}」前` : '挂闸待放行' };
    }
    case 'failed': {
      const f = active.stages.find((s) => s.status === 'failed');
      return { tone: 'fail', label: f ? `${stageLabel(f.name)}失败` : '失败' };
    }
    case 'running': {
      const cur = currentStage(active);
      if (cur?.status === 'waiting')
        return { tone: 'wait', label: `等 ${cur.lane ? LANE_META[cur.lane].label : ''} 闸` };
      if (cur) return { tone: 'run', label: `${stageLabel(cur.name)}…` };
      return { tone: 'run', label: '运行中' };
    }
    case 'queued':
      return { tone: 'muted', label: '排队' };
    case 'skipped': {
      if (main.kind === 'recheck') {
        const m = main.post?.recheckMisses;
        return { tone: 'muted', label: `无变化 · 已退避${m ? ` ${m} 轮` : ''}` };
      }
      return { tone: 'muted', label: '略过' };
    }
    case 'succeeded':
      return { tone: 'muted', label: '已完成' };
    default:
      return { tone: 'muted', label: '已取消' };
  }
}

function discoverStateOf(t: Task): { tone: RowTone; label: string } {
  switch (t.status) {
    case 'running': {
      const c = currentStage(t);
      return { tone: 'run', label: c ? `${stageLabel(c.name)}…` : '运行中' };
    }
    case 'paused':
      return { tone: 'gate', label: '挂闸待放行' };
    case 'failed':
      return { tone: 'fail', label: '发现失败' };
    case 'succeeded': {
      const sp = t.stages.find((s) => s.name === 'spawn');
      return { tone: 'muted', label: sp?.output ?? '已派生采集' };
    }
    default:
      return { tone: 'muted', label: '排队' };
  }
}

// ─── 选择器 ─────────────────────────────────────────────────────────────────────

function selectRun(
  w: World,
  runId: string,
  filters: { status: string; page: number; size: number },
) {
  const run = w.runs.find((r) => r.id === runId);
  if (!run) return null;
  const process = w.processes.find((p) => p.id === run.processId) ?? null;
  const blueprint = w.blueprints.find((b) => b.id === run.blueprintId) ?? null;
  const tasks = w.tasks.filter((t) => t.runId === runId);

  const insightByPost = new Map<string, Insight>();
  for (const i of w.insights) if (i.runId === runId) insightByPost.set(i.postId, i);

  // 发现入口（采集运行恰好一个 discover）
  const discoverTask = tasks.find((t) => t.kind === 'discover') ?? null;
  const discoverRow: RowModel | null = discoverTask
    ? (() => {
        const st = discoverStateOf(discoverTask);
        return {
          key: discoverTask.id,
          kind: 'discover' as const,
          source: blueprint?.sources[0]?.kind ?? null,
          title: '发现',
          post: null,
          segments: [
            {
              key: 'listing',
              label: '抓列表',
              status: segStatusOf(pick(discoverTask, ['fetch_listing']), discoverTask),
            },
            {
              key: 'dedup',
              label: '去重',
              status: segStatusOf(pick(discoverTask, ['dedup']), discoverTask),
            },
            {
              key: 'spawn',
              label: '派生采集',
              payoff: true,
              status: segStatusOf(pick(discoverTask, ['spawn']), discoverTask),
            },
          ],
          groups: [{ label: '发现', task: discoverTask }],
          activeTask: discoverTask,
          rowTone: st.tone,
          rowLabel: st.label,
          cat: st.tone === 'fail' ? 'failed' : st.tone === 'muted' ? 'done' : 'running',
        };
      })()
    : null;

  // 一帖一行：collect/recheck 为主，analyze 按 parentId 合并。
  // analyze 先按 parentId 建索引，避免逐帖 find 退化成 O(帖 × 任务)。
  const analyzeByParent = new Map<string, Task>();
  for (const t of tasks) if (t.kind === 'analyze' && t.parentId) analyzeByParent.set(t.parentId, t);
  const mains = tasks
    .filter((t) => t.kind === 'collect' || t.kind === 'recheck')
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);

  const rows: RowModel[] = mains.map((main) => {
    const analyze = analyzeByParent.get(main.id);
    const chain = analyze ? [main, analyze] : [main];
    const active = activeOf(chain);
    const insight = main.postId ? insightByPost.get(main.postId) : undefined;
    const st = rowStateOf(active, insight, main);
    const groups = [{ label: main.kind === 'collect' ? '采集' : '复查', task: main }];
    if (analyze) groups.push({ label: '分析', task: analyze });
    let cat: RowCat;
    if (st.tone === 'fail') cat = 'failed';
    else if (insight) cat = 'done';
    else {
      const s = active?.status;
      cat = s === 'succeeded' || s === 'skipped' || s === 'canceled' ? 'done' : 'running';
    }
    return {
      key: main.id,
      kind: main.kind,
      source: main.post?.source ?? null,
      title: main.post?.title ?? main.id,
      titleZh: main.post?.titleZh,
      post: main.post,
      segments: buildSegments(main, analyze),
      groups,
      activeTask: active,
      insight,
      rowTone: st.tone,
      rowLabel: st.label,
      cat,
    };
  });

  // 概览统计
  const total = mains.length;
  const collectDone = mains.filter(
    (t) => t.status === 'succeeded' || t.status === 'skipped',
  ).length;
  const analyzeTasks = tasks.filter((t) => t.kind === 'analyze');
  const analyzeDone = analyzeTasks.filter((t) => t.status === 'succeeded').length;
  const changed = rows.filter((r) => r.groups.some((g) => g.label === '分析')).length;
  const insights = insightByPost.size;

  // 按帖状态分桶（进度条 + 此刻图例）
  const bucket = {
    insight: 0,
    running: 0,
    waiting: 0,
    paused: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
  };
  for (const r of rows) {
    if (r.insight) {
      bucket.insight += 1;
      continue;
    }
    switch (r.rowTone) {
      case 'fail':
        bucket.failed += 1;
        break;
      case 'gate':
        bucket.paused += 1;
        break;
      case 'wait':
        bucket.waiting += 1;
        break;
      case 'run':
        bucket.running += 1;
        break;
      default: {
        const s = r.activeTask?.status;
        if (s === 'skipped' || s === 'canceled' || s === 'succeeded') bucket.skipped += 1;
        else bucket.pending += 1;
      }
    }
  }

  const elapsed =
    (run.status === 'running' ? w.nowMs : (run.finishedAt ?? w.nowMs)) - run.startedAt;

  // 帖子列表：按状态筛选 + 分页（只切当页 → DOM 恒有界，几百上千帖同样跑得动）
  const counts = { all: rows.length, running: 0, done: 0, failed: 0 };
  for (const r of rows) counts[r.cat] += 1;
  const filteredRows =
    filters.status === 'running' || filters.status === 'done' || filters.status === 'failed'
      ? rows.filter((r) => r.cat === filters.status)
      : rows;
  const filtered = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(filtered / filters.size));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const pageRows = filteredRows.slice((page - 1) * filters.size, page * filters.size);

  return {
    run,
    process,
    blueprint,
    discoverRow,
    pageRows,
    counts,
    filtered,
    page,
    pageCount,
    total,
    collectDone,
    analyzeTotal: analyzeTasks.length,
    analyzeDone,
    changed,
    insights,
    bucket,
    elapsed,
    nowMs: w.nowMs,
  };
}

type RunData = NonNullable<ReturnType<typeof selectRun>>;
type Bucket = RunData['bucket'];

// ─── 概览 ───────────────────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-xl font-semibold tabular-nums', accent && 'text-signal')}>
        {value}
      </div>
    </div>
  );
}

function StatusBar({ bucket, total }: { bucket: Bucket; total: number }) {
  if (total === 0) return <div className="h-2 rounded-full bg-muted" />;
  const seg = (n: number, cls: string, key: string) =>
    n > 0 ? <div key={key} className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-muted">
      {seg(bucket.insight, 'bg-signal', 'i')}
      {seg(bucket.skipped, 'bg-muted-foreground/40', 'k')}
      {seg(bucket.running, 'bg-primary', 'r')}
      {seg(bucket.waiting, 'bg-intensity-medium', 'w')}
      {seg(bucket.paused, 'bg-intensity-medium/60', 'p')}
      {seg(bucket.failed, 'bg-intensity-high', 'f')}
    </div>
  );
}

function Legend({ bucket }: { bucket: Bucket }) {
  const items: { c: string; t: string; cls: string }[] = [];
  if (bucket.insight)
    items.push({ c: 'bg-signal', t: `出洞察 ${bucket.insight}`, cls: 'text-signal' });
  if (bucket.running)
    items.push({ c: 'bg-primary signal-pulse', t: `在跑 ${bucket.running}`, cls: 'text-primary' });
  if (bucket.waiting)
    items.push({
      c: 'bg-intensity-medium',
      t: `等闸 ${bucket.waiting}`,
      cls: 'text-intensity-medium',
    });
  if (bucket.paused)
    items.push({
      c: 'bg-intensity-medium/60',
      t: `挂闸 ${bucket.paused}`,
      cls: 'text-intensity-medium',
    });
  if (bucket.failed)
    items.push({ c: 'bg-intensity-high', t: `失败 ${bucket.failed}`, cls: 'text-destructive' });
  if (bucket.skipped)
    items.push({
      c: 'bg-muted-foreground/40',
      t: `无变化/略过 ${bucket.skipped}`,
      cls: 'text-muted-foreground',
    });
  if (bucket.pending)
    items.push({
      c: 'bg-muted-foreground/30',
      t: `待处理 ${bucket.pending}`,
      cls: 'text-muted-foreground',
    });
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map((x, i) => (
        <span key={i} className={cn('inline-flex items-center gap-1.5', x.cls)}>
          <span className={cn('size-1.5 rounded-full', x.c)} />
          {x.t}
        </span>
      ))}
    </div>
  );
}

function Summary({ data }: { data: RunData }) {
  const { run, blueprint, total, changed, insights, bucket } = data;
  const isRunning = run.status === 'running';
  const src = blueprint
    ? blueprint.sources
        .flatMap((s) => s.channels)
        .slice(0, 2)
        .join('、')
    : '来源';
  const ins = <span className="font-medium tabular-nums text-signal">{insights}</span>;
  const num = (n: number) => <span className="font-medium tabular-nums text-foreground">{n}</span>;

  const live: ReactNode[] = [];
  if (bucket.running) live.push(<span className="text-primary">{bucket.running} 帖在跑</span>);
  if (bucket.waiting)
    live.push(<span className="text-intensity-medium">{bucket.waiting} 帖等闸</span>);
  if (bucket.paused)
    live.push(<span className="text-intensity-medium">{bucket.paused} 帖被你挂闸</span>);
  if (bucket.failed) live.push(<span className="text-destructive">{bucket.failed} 帖失败</span>);
  const liveTail =
    isRunning && live.length > 0 ? (
      <>
        {' '}
        此刻{' '}
        {live.map((node, i) => (
          <span key={i}>
            {i > 0 ? '、' : ''}
            {node}
          </span>
        ))}
        。
      </>
    ) : null;

  let body: ReactNode;
  if (run.kind === 'collect') {
    body = isRunning ? (
      <>
        正在采集 <span className="text-foreground">{src}</span> —— 已发现 {num(total)} 帖、分析出{' '}
        {ins} 条洞察。{liveTail}
      </>
    ) : (
      <>
        从 <span className="text-foreground">{src}</span> 采集了 {num(total)} 帖，分析出 {ins}{' '}
        条洞察。
      </>
    );
  } else {
    body = isRunning ? (
      <>
        复查 sweep #{run.sweepSeq} —— 查了 {num(total)} 帖，{num(changed)} 帖有更新、产出 {ins}{' '}
        条洞察，其余无变化已退避。{liveTail}
      </>
    ) : (
      <>
        本轮复查 {num(total)} 帖，{num(changed)} 帖有更新、产出 {ins}{' '}
        条洞察，其余无变化、已按退避顺延。
      </>
    );
  }
  return <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>;
}

function RunOverview({ data }: { data: RunData }) {
  const { run, total, collectDone, analyzeTotal, analyzeDone, changed, insights, bucket, elapsed } =
    data;
  const isRunning = run.status === 'running';
  const isCollect = run.kind === 'collect';
  const doneRows = bucket.insight + bucket.skipped;
  const pct = total > 0 ? Math.round((doneRows / total) * 100) : 0;

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Activity
            className={cn('size-4', isRunning ? 'text-primary' : 'text-muted-foreground')}
          />
          {isRunning ? '运行此刻' : run.status === 'failed' ? '运行失败' : '运行结果'}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {isRunning ? '已跑' : '耗时'} {fmtDur(elapsed)}
        </span>
      </div>

      <Summary data={data} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={isCollect ? '发现' : '复查'} value={total} />
        {isCollect ? (
          <Stat
            label="采集"
            value={
              <>
                {collectDone}
                <span className="text-sm text-muted-foreground">/{total}</span>
              </>
            }
          />
        ) : (
          <Stat label="有更新" value={changed} />
        )}
        <Stat
          label="分析"
          value={
            <>
              {analyzeDone}
              <span className="text-sm text-muted-foreground">/{analyzeTotal}</span>
            </>
          }
        />
        <Stat label="洞察" value={insights} accent />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="tabular-nums">
            <span className="font-semibold text-foreground">{doneRows}</span>
            <span className="text-muted-foreground">/{total} 帖完成</span>
          </span>
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <StatusBar bucket={bucket} total={total} />
        <Legend bucket={bucket} />
      </div>

      {insights > 0 ? (
        <Link
          to="/radar/insights"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Sparkles className="size-3.5 text-intensity-high" />
          本次已收成 <span className="font-medium tabular-nums text-foreground">
            {insights}
          </span>{' '}
          条洞察 →
        </Link>
      ) : null}
    </Card>
  );
}

// ─── 帖子卡 + 评论树（展开内复用） ─────────────────────────────────────────────

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

function IntensityBadge({ i }: { i: Intensity }) {
  const m = INTENSITY_META[i];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-medium', m.text)}>
      <span className={cn('size-1.5 rounded-full', m.bar)} />
      {m.label}
    </span>
  );
}

// ─── 管线（收起行的语义段） ─────────────────────────────────────────────────────

function Pipeline({ segments }: { segments: Seg[] }) {
  return (
    <div className="flex flex-wrap items-center gap-y-1 text-xs">
      {segments.map((s, i) => {
        const payoffDone = s.payoff && s.status === 'done';
        return (
          <div key={s.key} className="flex items-center">
            <span
              className={cn(
                'inline-flex items-center gap-1.5',
                payoffDone ? 'text-signal' : SEG_TEXT[s.status],
              )}
            >
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  payoffDone ? 'bg-signal' : SEG_DOT[s.status],
                )}
              />
              {s.label}
            </span>
            {i < segments.length - 1 ? (
              <span
                className={cn(
                  'mx-1.5 h-px w-3.5 sm:w-5',
                  s.status === 'done' || s.status === 'skipped'
                    ? 'bg-muted-foreground/40'
                    : 'bg-border',
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── 展开内：逐环节 + 操控 ──────────────────────────────────────────────────────

function StageLine({
  task,
  stage,
  selected,
  onSelect,
}: {
  task: Task;
  stage: Stage;
  selected: boolean;
  onSelect: () => void;
}) {
  const canGate = stage.status === 'pending';
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
        selected ? 'bg-accent' : '',
      )}
    >
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          stage.status === 'running' && 'signal-pulse',
          STAGE_STATUS_META[stage.status].dot,
        )}
      />
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="shrink-0">{stageLabel(stage.name)}</span>
        {stage.name === 'ai_call' ? (
          <span className="shrink-0 text-[10px] text-intensity-high">花钱</span>
        ) : null}
        <span className="min-w-0 truncate text-muted-foreground/60">{stage.output ?? ''}</span>
      </button>
      <button
        type="button"
        disabled={!canGate}
        onClick={() => toggleGate(task.id, stage.seq)}
        aria-label={stage.gate ? '摘闸门' : '挂闸门'}
        className={cn('shrink-0', canGate ? 'hover:text-foreground' : 'cursor-default opacity-40')}
      >
        {stage.gate ? (
          <Lock className="size-3.5 text-intensity-medium" />
        ) : (
          <LockOpen className="size-3.5 text-muted-foreground/50" />
        )}
      </button>
      <span className="w-12 shrink-0 text-right text-muted-foreground">
        {STAGE_STATUS_META[stage.status].label}
      </span>
    </div>
  );
}

function ProductPanel({ task, stage }: { task: Task; stage: Stage }) {
  const isComments = stage.name === 'fetch_comments' || stage.name === 'recrawl';
  return (
    <div className="rounded-md border bg-background p-3 text-sm">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        产物 · <span className="text-foreground">{stageLabel(stage.name)}</span>
        {stage.name === 'ai_call' ? (
          <span className="text-intensity-high">· 花钱 · 不可重算</span>
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
  );
}

function Controls({ task }: { task: Task }) {
  if (task.status === 'paused')
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => releaseStage(task.id)}>
            <SkipForward className="size-3.5" /> 放行下一步
          </Button>
          <Button size="sm" variant="outline" onClick={() => runToEnd(task.id)}>
            <Play className="size-3.5" /> 运行到底
          </Button>
          <Button size="sm" variant="ghost" onClick={() => cancelTask(task.id)}>
            取消
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          放行下一步 = 跑完当前环节就停在下一个；运行到底 = 清掉后续所有闸门一口气跑完。
        </p>
      </div>
    );
  if (task.status === 'failed')
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => retryStage(task.id)}>
          <RefreshCw className="size-3.5" /> 重试本环节
        </Button>
        <Button size="sm" variant="ghost" onClick={() => cancelTask(task.id)}>
          取消
        </Button>
      </div>
    );
  if (task.status === 'running' || task.status === 'queued')
    return (
      <Button size="sm" variant="ghost" onClick={() => cancelTask(task.id)}>
        取消
      </Button>
    );
  return null;
}

// ─── 一行（收起 + 就地展开） ────────────────────────────────────────────────────

function ExecRow({
  row,
  nowMs,
  open,
  onToggle,
}: {
  row: RowModel;
  nowMs: number;
  open: boolean;
  onToggle: () => void;
}) {
  const preferOriginal = useLang();
  const [sel, setSel] = useState<{ taskId: string; seq: number } | null>(null);
  const isDiscover = row.kind === 'discover';
  const Icon = row.source ? SOURCE_META[row.source].icon : Search;
  const title = isDiscover
    ? '发现 · 扫描列表 → 去重 → 派生采集'
    : tText(row.title, row.titleZh, preferOriginal);

  const selGroup = sel != null ? row.groups.find((g) => g.task.id === sel.taskId) : undefined;
  const selStage = selGroup?.task.stages.find((s) => s.seq === sel?.seq);
  const selTask = selGroup?.task;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="truncate text-sm">{title}</div>
          <Pipeline segments={row.segments} />
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {row.insight ? <IntensityBadge i={row.insight.intensity} /> : null}
          <span
            className={cn('hidden max-w-[15rem] truncate text-xs sm:inline', ROW_TONE[row.rowTone])}
          >
            {row.rowLabel}
          </span>
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </div>
      </button>

      {open ? (
        <div className="space-y-3 border-t bg-muted/20 px-3 pt-3 pb-3.5">
          <div className={cn('text-xs sm:hidden', ROW_TONE[row.rowTone])}>{row.rowLabel}</div>

          {row.post ? (
            <div className="space-y-1.5">
              <PostCard post={row.post} nowMs={nowMs} />
              <Link
                to={`/radar/posts/${row.post.id}`}
                className="inline-flex items-center gap-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                看这帖一生 →
              </Link>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              扫描列表页 → 候选反连接去重 → 派生采集子任务。
            </p>
          )}

          <div className="space-y-2">
            {row.groups.map((g) => (
              <div key={g.task.id}>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{g.label}</div>
                <div className="space-y-0.5">
                  {g.task.stages.map((s) => (
                    <StageLine
                      key={s.seq}
                      task={g.task}
                      stage={s}
                      selected={sel?.taskId === g.task.id && sel?.seq === s.seq}
                      onSelect={() => setSel({ taskId: g.task.id, seq: s.seq })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {selStage && selTask ? <ProductPanel task={selTask} stage={selStage} /> : null}

          {row.activeTask ? <Controls task={row.activeTask} /> : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── 页面 ──────────────────────────────────────────────────────────────────────

function RunDetailView() {
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const status = sp.get('status') ?? '';
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
  const size = PAGE_SIZES.includes(Number(sp.get('size'))) ? Number(sp.get('size')) : DEFAULT_SIZE;
  const data = useWorld((w) => selectRun(w, runId, { status, page, size }));

  if (!data) return <EmptyState title="运行不存在" hint="它可能已被清理。返回指挥室看看。" />;
  const { run, process, blueprint, discoverRow, pageRows, counts, nowMs } = data;
  const rm = RUN_STATUS_META[run.status];
  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key));

  /** 切状态筛选：回第 1 页，保留每页条数偏好。 */
  const applyStatus = (s: string): void => {
    const params = new URLSearchParams();
    if (s) params.set('status', s);
    if (size !== DEFAULT_SIZE) params.set('size', String(size));
    const qs = params.toString();
    navigate(qs ? `/radar/runs/${runId}?${qs}` : `/radar/runs/${runId}`);
  };

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

        {run.status === 'failed' && run.error ? (
          <Card className="flex-row items-center gap-2 border-destructive/30 p-3 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {run.error}
          </Card>
        ) : null}

        {discoverRow ? (
          <Card className="gap-0 overflow-hidden p-0">
            <ExecRow
              row={discoverRow}
              nowMs={nowMs}
              open={openKey === discoverRow.key}
              onToggle={() => toggle(discoverRow.key)}
            />
          </Card>
        ) : null}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">帖子 · {counts.all}</h2>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map((t) => {
                const n = t.key === '' ? counts.all : counts[t.key];
                const active = status === t.key;
                return (
                  <button
                    key={t.key || 'all'}
                    type="button"
                    onClick={() => applyStatus(t.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {t.label}
                    <span className="tabular-nums opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Card className="gap-0 divide-y overflow-hidden p-0">
            {pageRows.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {counts.all === 0 ? '任务派生中…' : '该状态下没有帖子。'}
              </p>
            ) : (
              pageRows.map((r) => (
                <ExecRow
                  key={r.key}
                  row={r}
                  nowMs={nowMs}
                  open={openKey === r.key}
                  onToggle={() => toggle(r.key)}
                />
              ))
            )}
          </Card>

          {data.pageCount > 1 ? (
            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              total={data.filtered}
              basePath={`/radar/runs/${runId}`}
              query={{ status }}
              pageSize={size}
              pageSizeOptions={PAGE_SIZES}
            />
          ) : null}
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
