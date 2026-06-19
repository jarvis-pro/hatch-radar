/**
 * 运行任务星图（原型）：Obsidian 式力导向关系图谱，铺满可用空间的全画布 + 悬浮 UI。
 *
 * 设计要点（见对话定稿）：
 * - 无「运行」中心节点：discover（采集根）/ recheck（复查根）即顶层；连线 = 派生血缘。
 * - 节点 = 任务，内嵌 kind 单字标 + 标签（帖子标题，可开关）；颜色编码状态、让问题跳出来。
 * - L3 折进画布：点中任务 → 原地绽放出按 seq 排布的环节弧（守时序）。
 * - 全画布 + 上层悬浮：概要 / 筛选 / 缩放 / 全屏 / 图例 / 选中面板全部 absolute 浮在画布上。
 * - 缩放 + 平移（滚轮 / 按钮 / 拖背景）+ 全屏（Fullscreen API，root 全屏含所有 overlay）。
 *
 * 仅用 d3-force 跑模拟（base 坐标），缩放/平移由外层 <g> 变换施加，物理不受缩放影响。
 * 零自定义 CSS——颜色走主题 token 的 tailwind `fill-*`/`stroke-*`/`bg-*` 类。
 */
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { Maximize, Minimize, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { KIND_META, RUN_STATUS_META, TASK_KIND_META } from './constants';
import type { Run, Task, TaskKind } from './types';
import { relTime } from './util';

const W = 600;
const H = 460;
const CX = W / 2;
const CY = H / 2;
const LABEL_PAD = 42;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;

interface GNode extends SimulationNodeDatum {
  id: string;
  kind: TaskKind;
  status: string;
  parentId: string | null;
  r: number;
}
type GLink = SimulationLinkDatum<GNode>;

function radiusOf(kind: TaskKind): number {
  return kind === 'discover' ? 13 : kind === 'analyze' || kind === 'translate' ? 8.5 : 11;
}

const NODE_FILL: Record<string, string> = {
  succeeded: 'fill-muted-foreground',
  done: 'fill-muted-foreground',
  running: 'fill-primary',
  paused: 'fill-intensity-medium',
  failed: 'fill-intensity-high',
  canceled: 'fill-muted-foreground/40',
  skipped: 'fill-muted-foreground/30',
  queued: 'fill-muted-foreground/25',
  pending: 'fill-muted-foreground/25',
};
function fillClass(status: string): string {
  return NODE_FILL[status] ?? 'fill-muted-foreground';
}
const HALO_STROKE: Record<string, string> = {
  running: 'stroke-primary',
  failed: 'stroke-intensity-high',
  paused: 'stroke-intensity-medium',
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
type SeededSim = Simulation<GNode, GLink> & { randomSource?: (f: () => number) => unknown };

type Filter = 'all' | 'alert' | 'failed';
const FILTER_CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'alert', label: '只看异常' },
  { key: 'failed', label: '失败' },
];
const LEGEND_STATUS: { dot: string; label: string }[] = [
  { dot: 'bg-muted-foreground', label: '完成' },
  { dot: 'bg-primary', label: '运行中' },
  { dot: 'bg-intensity-medium', label: '暂停' },
  { dot: 'bg-intensity-high', label: '失败' },
  { dot: 'bg-muted-foreground/30', label: '跳过' },
];

export function RunConstellation({
  run,
  tasks,
  ordinal,
  selectedId,
  stageSeq,
  onSelectTask,
  onSelectStage,
  panel,
}: {
  run: Run;
  tasks: Task[];
  ordinal: number | null;
  selectedId: string | null;
  stageSeq: number | null;
  onSelectTask: (id: string | null) => void;
  onSelectStage: (seq: number | null) => void;
  panel: ReactNode;
}) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [hover, setHover] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(run.status === 'failed' ? 'alert' : 'all');
  const [showLabels, setShowLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFs, setIsFs] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<
    | { kind: 'node'; n: GNode; moved: boolean; sx: number; sy: number }
    | { kind: 'pan'; moved: boolean; sx: number; sy: number; px: number; py: number }
    | null
  >(null);

  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = pan;
  }, [zoom, pan]);

  const { childrenOf, parentOf } = useMemo(() => {
    const childrenOf: Record<string, string[]> = {};
    const parentOf: Record<string, string> = {};
    for (const t of tasks) {
      if (t.parentId) {
        parentOf[t.id] = t.parentId;
        (childrenOf[t.parentId] = childrenOf[t.parentId] ?? []).push(t.id);
      }
    }
    return { childrenOf, parentOf };
  }, [tasks]);

  function neighbors(id: string): Set<string> {
    const s = new Set<string>([id]);
    let p: string | undefined = parentOf[id];
    while (p) {
      s.add(p);
      p = parentOf[p];
    }
    for (const c of childrenOf[id] ?? []) s.add(c);
    return s;
  }

  useEffect(() => {
    const gnodes: GNode[] = tasks.map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      parentId: t.parentId,
      r: radiusOf(t.kind),
    }));
    gnodes.forEach((n, i) => {
      const a = i * 2.39996323;
      const rr = 16 + 7 * Math.sqrt(i);
      n.x = CX + rr * Math.cos(a);
      n.y = CY + rr * Math.sin(a);
    });
    // 钉住 discover 根作中心枢纽（采集图稳定）；复查无 discover 则靠 forceX/Y 居中。
    const hub = gnodes.find((n) => n.kind === 'discover');
    if (hub) {
      hub.fx = CX;
      hub.fy = CY;
    }
    const glinks: GLink[] = tasks
      .filter((t) => t.parentId)
      .map((t) => ({ source: t.parentId as string, target: t.id }));

    const sim = forceSimulation<GNode, GLink>(gnodes)
      .force(
        'link',
        forceLink<GNode, GLink>(glinks)
          .id((d) => d.id)
          .distance((l) => {
            const k = (l.target as GNode).kind;
            return k === 'analyze' || k === 'translate' ? 34 : k === 'discover' ? 58 : 52;
          })
          .strength(0.75),
      )
      .force('charge', forceManyBody<GNode>().strength(-150))
      .force(
        'collide',
        forceCollide<GNode>().radius((d) => d.r + 7),
      )
      .force('x', forceX<GNode>(CX).strength(0.06))
      .force('y', forceY<GNode>(CY).strength(0.06))
      .on('tick', () => {
        for (const n of gnodes) {
          if (n.fx != null) continue;
          n.x = clamp(n.x ?? CX, n.r + 6, W - n.r - 6);
          n.y = clamp(n.y ?? CY, n.r + 6, H - n.r - LABEL_PAD);
        }
        bump();
      });
    (sim as SeededSim).randomSource?.(mulberry32(seedFrom(run.id)));

    nodesRef.current = gnodes;
    linksRef.current = glinks;
    simRef.current = sim;
    bump();
    return () => {
      sim.stop();
    };
  }, [run.id, run.status, tasks]);

  // 滚轮缩放（指向光标处），原生非 passive 监听以便 preventDefault；只用 ref/setter 保持自包含。
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = pt.matrixTransform(ctm.inverse());
      const z = zoomRef.current;
      const nz = clamp(z * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX);
      const p0 = panRef.current;
      const np = { x: p.x - (p.x - p0.x) * (nz / z), y: p.y - (p.y - p0.y) * (nz / z) };
      zoomRef.current = nz;
      panRef.current = np;
      setZoom(nz);
      setPan(np);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // 全屏状态同步。
  useEffect(() => {
    const h = (): void => setIsFs(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  function toSvg(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function applyZoom(factor: number, fx: number, fy: number): void {
    const z = zoomRef.current;
    const nz = clamp(z * factor, ZOOM_MIN, ZOOM_MAX);
    const p = panRef.current;
    const np = { x: fx - (fx - p.x) * (nz / z), y: fy - (fy - p.y) * (nz / z) };
    zoomRef.current = nz;
    panRef.current = np;
    setZoom(nz);
    setPan(np);
  }
  function resetView(): void {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }
  function toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }

  function onNodeDown(e: ReactPointerEvent, n: GNode): void {
    e.stopPropagation();
    dragRef.current = { kind: 'node', n, moved: false, sx: e.clientX, sy: e.clientY };
    n.fx = n.x;
    n.fy = n.y;
    simRef.current?.alphaTarget(0.3).restart();
  }
  function onBgDown(e: ReactPointerEvent): void {
    dragRef.current = {
      kind: 'pan',
      moved: false,
      sx: e.clientX,
      sy: e.clientY,
      px: pan.x,
      py: pan.y,
    };
  }
  function onSvgMove(e: ReactPointerEvent): void {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    const p = toSvg(e.clientX, e.clientY);
    if (!p) return;
    if (d.kind === 'node') {
      d.n.fx = (p.x - panRef.current.x) / zoomRef.current;
      d.n.fy = (p.y - panRef.current.y) / zoomRef.current;
    } else {
      const sp = toSvg(d.sx, d.sy);
      if (sp) setPan({ x: d.px + (p.x - sp.x), y: d.py + (p.y - sp.y) });
    }
  }
  function onSvgUp(): void {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'node') {
      simRef.current?.alphaTarget(0);
      if (d.n.fx != null && d.n.kind !== 'discover') {
        d.n.fx = null;
        d.n.fy = null;
      }
      if (!d.moved) onSelectTask(d.n.id);
    } else if (!d.moved) {
      onSelectTask(null);
    }
    dragRef.current = null;
  }

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const nb = hover ? neighbors(hover) : null;
  const selTask = selectedId ? (tasks.find((t) => t.id === selectedId) ?? null) : null;
  const selNode = selectedId ? (nodes.find((n) => n.id === selectedId) ?? null) : null;

  const counts = useMemo(() => {
    let failed = 0;
    let running = 0;
    let paused = 0;
    for (const t of tasks) {
      if (t.status === 'failed') failed++;
      else if (t.status === 'running') running++;
      else if (t.status === 'paused') paused++;
    }
    return { failed, running, paused };
  }, [tasks]);

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t] as const)), [tasks]);

  function vis(n: GNode): boolean {
    if (filter === 'all') return true;
    if (filter === 'failed') return n.status === 'failed';
    return n.status === 'failed' || n.status === 'paused' || n.status === 'running';
  }
  function nodeOpacity(n: GNode): number {
    if (!vis(n)) return 0.1;
    if (nb) return nb.has(n.id) ? 1 : 0.16;
    return 1;
  }
  function labelFor(n: GNode): string {
    if (n.kind === 'discover') return '发现';
    const post = taskMap.get(n.id)?.post;
    return post ? truncate(post.title, 16) : (TASK_KIND_META[n.kind]?.label ?? n.kind);
  }
  function titleFor(n: GNode): string {
    const base = `${TASK_KIND_META[n.kind]?.label ?? n.kind} · ${n.status}`;
    const post = taskMap.get(n.id)?.post;
    return post
      ? `${base}\n${post.title}\n↑${post.score} · ${post.numComments} 评论 · 最深 ${post.commentDepth} 层`
      : base;
  }

  const bloom = (() => {
    if (!selNode || !selTask || selTask.stages.length === 0) return null;
    const cx = selNode.x ?? CX;
    const cy = selNode.y ?? CY;
    const n = selTask.stages.length;
    const base = Math.atan2(cy - CY, cx - CX) || -Math.PI / 2;
    const spread = Math.min(1.9, 0.6 * n);
    const R = selNode.r + 28;
    const step = n > 1 ? spread / (n - 1) : 0;
    return selTask.stages.map((st, i) => {
      const ang = base + (i - (n - 1) / 2) * step;
      return { st, i, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), cx, cy };
    });
  })();

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden rounded-lg border bg-card">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full touch-none select-none"
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
        onPointerLeave={onSvgUp}
      >
        <defs>
          <pattern id="rc-dots" width={22} height={22} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} className="fill-border" />
          </pattern>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          <rect
            x={-6000}
            y={-6000}
            width={12000}
            height={12000}
            fill="url(#rc-dots)"
            opacity={0.5}
            className="cursor-grab"
            onPointerDown={onBgDown}
          />

          <g>
            {links.map((l, i) => {
              const s = l.source as GNode;
              const t = l.target as GNode;
              if (typeof s !== 'object' || typeof t !== 'object') return null;
              const both = vis(s) && vis(t);
              const op = !both ? 0.05 : nb ? (nb.has(s.id) && nb.has(t.id) ? 0.75 : 0.07) : 0.4;
              const live = t.status === 'running';
              return (
                <line
                  key={i}
                  x1={s.x ?? CX}
                  y1={s.y ?? CY}
                  x2={t.x ?? CX}
                  y2={t.y ?? CY}
                  className={live ? 'stroke-primary' : 'stroke-border'}
                  strokeWidth={live ? 1.6 : 1}
                  strokeOpacity={op}
                />
              );
            })}
          </g>

          {bloom ? (
            <g>
              {bloom.map((b) => (
                <line
                  key={`bl${b.i}`}
                  x1={b.cx}
                  y1={b.cy}
                  x2={b.x}
                  y2={b.y}
                  className="stroke-border"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
              ))}
              {bloom.map((b) => (
                <g
                  key={`bp${b.i}`}
                  transform={`translate(${b.x},${b.y})`}
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectStage(b.i);
                  }}
                >
                  {b.st.gate ? (
                    <circle
                      r={8.5}
                      className="fill-none stroke-intensity-medium"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      strokeOpacity={0.85}
                    />
                  ) : null}
                  {stageSeq === b.i ? (
                    <circle r={9} className="fill-none stroke-primary" strokeWidth={2} />
                  ) : null}
                  <circle
                    r={5.5}
                    className={`${fillClass(b.st.status)} stroke-background`}
                    strokeWidth={1.5}
                  />
                  {showLabels ? (
                    <text x={7} dy="0.32em" fontSize={9} className="fill-muted-foreground">
                      {b.st.name}
                    </text>
                  ) : null}
                  <title>{`${b.st.name}${b.st.gate ? ' · 闸门' : ''} · ${b.st.status}`}</title>
                </g>
              ))}
            </g>
          ) : null}

          <g>
            {nodes.map((n) => {
              const halo = HALO_STROKE[n.status];
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x ?? CX},${n.y ?? CY})`}
                  opacity={nodeOpacity(n)}
                  className="cursor-pointer"
                  style={{ pointerEvents: vis(n) ? 'auto' : 'none' }}
                  onPointerDown={(e) => onNodeDown(e, n)}
                  onPointerEnter={() => !dragRef.current && setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                >
                  {selectedId === n.id ? (
                    <circle
                      r={n.r + 6}
                      className="fill-none stroke-primary"
                      strokeWidth={2}
                      strokeOpacity={0.7}
                    />
                  ) : null}
                  {halo ? (
                    <circle
                      r={n.r + 4}
                      className={`fill-none ${halo} ${n.status === 'running' ? 'animate-pulse' : ''}`}
                      strokeWidth={1.5}
                      strokeOpacity={0.6}
                      strokeDasharray={n.status === 'paused' ? '3 3' : undefined}
                    />
                  ) : null}
                  <circle
                    r={n.r}
                    className={`${fillClass(n.status)} stroke-background`}
                    strokeWidth={1.5}
                  />
                  <text
                    textAnchor="middle"
                    dy="0.34em"
                    fontSize={Math.round(n.r * 1.02)}
                    className="fill-background font-medium"
                  >
                    {TASK_KIND_META[n.kind]?.tag ?? '?'}
                  </text>
                  {showLabels || hover === n.id || selectedId === n.id ? (
                    <text
                      textAnchor="middle"
                      y={n.r + 11}
                      fontSize={10}
                      className="fill-muted-foreground"
                    >
                      {labelFor(n)}
                    </text>
                  ) : null}
                  <title>{titleFor(n)}</title>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* 左上：运行概要 + 筛选 / 标签 */}
      <div className="absolute left-3 top-3 z-10 max-w-[min(70%,28rem)] space-y-1.5 rounded-lg border bg-card/90 px-3 py-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">
            {ordinal != null ? `运行 #${ordinal}` : '运行详情'}
          </span>
          <Badge variant={RUN_STATUS_META[run.status].variant}>
            {RUN_STATUS_META[run.status].label}
          </Badge>
          <span className="text-xs tabular-nums text-muted-foreground">
            {KIND_META[run.kind].label} · {run.tasksDone}/{run.tasksTotal} · {tasks.length} 任务
            {counts.failed > 0 ? (
              <span className="text-destructive"> · {counts.failed} 失败</span>
            ) : null}
            {' · '}
            {relTime(run.startedAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_CHIPS.map((c) => (
            <Button
              key={c.key}
              size="sm"
              variant={filter === c.key ? 'default' : 'outline'}
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setFilter(c.key)}
            >
              {c.label}
            </Button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-border" />
          <Button
            size="sm"
            variant={showLabels ? 'default' : 'outline'}
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => setShowLabels((v) => !v)}
          >
            标签
          </Button>
        </div>
      </div>

      {/* 右上：缩放 + 全屏 */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border bg-card/90 p-1 backdrop-blur-sm">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="缩小"
          onClick={() => applyZoom(0.8, CX, CY)}
        >
          <ZoomOut className="size-4" />
        </Button>
        <button
          type="button"
          onClick={resetView}
          className="min-w-12 rounded px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground"
          aria-label="重置视图"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="放大"
          onClick={() => applyZoom(1.25, CX, CY)}
        >
          <ZoomIn className="size-4" />
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={isFs ? '退出全屏' : '全屏'}
          onClick={toggleFullscreen}
        >
          {isFs ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
        </Button>
      </div>

      {/* 右侧：选中任务面板（浮层） */}
      {selTask && panel ? (
        <aside className="absolute bottom-3 right-3 top-16 z-10 w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border bg-card p-4 shadow-lg">
          <Button
            size="icon-sm"
            variant="ghost"
            className="absolute right-2 top-2 text-muted-foreground"
            aria-label="关闭"
            onClick={() => onSelectTask(null)}
          >
            <X className="size-4" />
          </Button>
          {panel}
        </aside>
      ) : null}

      {/* 左下：图例 */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
        {LEGEND_STATUS.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className={`size-2 shrink-0 rounded-full ${s.dot}`} />
            {s.label}
          </span>
        ))}
        <span className="h-3 w-px bg-border" />
        <span>发/采/查/析 = 发现/采集/复查/分析</span>
      </div>
    </div>
  );
}
