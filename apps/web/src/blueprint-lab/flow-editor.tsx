/**
 * 图纸流程连线编辑器（react-flow，可编辑 DAG）—— 取代写死的「固定环节模板」。
 *
 * 交互模型：
 * - **起止哨兵**：每张图纸恒有「开始」「结束」两个特殊节点（{@link TerminalNode}，胶囊样式、
 *   起始只出、结束只入），**不可删除**（react-flow `deletable:false` + 右键菜单删除项禁用）。
 * - **操作区放大 + 悬浮控件**（布局参考运行详情 RunConstellation）：左上浮数据源 / 参数只读信息
 *   （{@link InfoBar}，点击穿透）、右上浮缩放药丸（缩小 / 百分比→fitView / 放大 / 全屏）、
 *   左下浮操作提示（默认收起为 Info 按钮）、右下浮「保存 / 重置」（仅有未保存改动时出现）。
 * - **输入 / 输出各限一条（纯线性链、不分叉 / 汇聚）**：节点左 = 输入、右 = 输出，线只能输出 → 输入。
 *   **输出**已有出边 → 句柄 `isConnectableStart={!hasOutgoing}`（`useNodeConnections` 查得），直接拉不出线、
 *   无反应、不提示；**输入**已有入边 → `isValidConnection` 判无效（拖到该输入标红、松手不连）。
 *   连线走 smoothstep（用足空间）。
 * - **拖放建节点**：从输出拖线松手在空白处 → 弹「创建菜单」，选中环节即建节点并把线接上。
 * - **空白右键建节点**：`onPaneContextMenu` 弹同一菜单，但只建节点、不连线。
 * - **节点右键**：`onNodeContextMenu` 弹节点菜单（挂 / 摘闸门、删除；起止节点删除项禁用）。
 * - **连线取消**：悬停线中点 / 选中边浮出 ✕、右键边菜单、或选中按 Delete（见 {@link DeletableEdge}）。
 *
 * 受控：`value` 仅在挂载时初始化内部画布状态（编辑期间画布自管，避免父回传造成循环）；任何变更经
 * `onChange` 回传序列化后的 {@link FlowGraph}（**含坐标**），由父保存。切换图纸 / 全屏 / 重置用 `key` 强制重挂。
 * 保存为**主动触发**（右下角按钮），不再自动写回。stage 节点 `type` 必须是执行内核认识的环节。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  type Connection,
  ConnectionLineType,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  type FinalConnectionState,
  getSmoothStepPath,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodeConnections,
  useNodesState,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CircleCheck,
  Flag,
  Info,
  type LucideIcon,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Save,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import { toast } from '@hatch-radar/ui/components/sonner';
import { useTheme } from '@hatch-radar/ui/components/theme-provider';
import { cn } from '@hatch-radar/ui/lib/utils';
import {
  END_NODE,
  isTerminal,
  KIND_META,
  SOURCE_META,
  START_NODE,
  type StageType,
  stageType,
  stageTypesForKind,
} from './constants';
import { mockApi } from './mock';
import type { Blueprint, CollectParams, FlowGraph, RecheckParams } from './types';
import { KEYS } from './util';

/**
 * react-flow 自定义节点携带的数据（纯数据，操作走右键菜单 → 无回调闭包同步问题）。
 * stage 节点用 typeName/gate；terminal（起止哨兵）用 terminal。两类共用一个数据形以省去联合判别。
 */
interface FlowNodeData extends Record<string, unknown> {
  /** 环节类型 name（STAGE_TYPES.name）—— stage 节点。 */
  typeName?: string;
  /** 是否挂闸门 —— stage 节点。 */
  gate?: boolean;
  /** 哨兵种类 —— terminal 节点。 */
  terminal?: 'start' | 'end';
}
type FlowNodeT = Node<FlowNodeData>;

/** 输入插槽（左）：中性描边空心圆 —— 只接线，不可作起点（线无法从输入牵出）。 */
const INPUT_HANDLE_STYLE = {
  width: 11,
  height: 11,
  background: 'var(--background)',
  border: '2px solid var(--muted-foreground)',
} as const;

/** 输出插槽（右）：primary 实心圆 —— 拉线起点，略大以邀请拖拽；不可作落点。 */
const OUTPUT_HANDLE_STYLE = {
  width: 13,
  height: 13,
  background: 'var(--primary)',
  border: '2px solid var(--background)',
} as const;

/** 哨兵节点插槽：背景填充 + primary 描边，在实心 / 浅填两种胶囊上都清晰。 */
const TERMINAL_HANDLE_STYLE = {
  width: 12,
  height: 12,
  background: 'var(--background)',
  border: '2px solid var(--primary)',
} as const;

/** 起止哨兵节点元信息（标签 + 图标）。 */
const TERMINAL_META: Record<'start' | 'end', { label: string; icon: LucideIcon }> = {
  start: { label: '开始', icon: Play },
  end: { label: '结束', icon: CircleCheck },
};

/** 新边默认样式：primary smoothstep + 箭头（DAG 有向）+ 可删边类型。onConnect 新建的边自动套用。 */
const DEFAULT_EDGE = {
  type: 'deletable',
  markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--primary)', width: 18, height: 18 },
  style: { stroke: 'var(--primary)', strokeWidth: 2 },
};

/**
 * 环节节点卡片（信息丰富版）：图标头部（图标 + 中文名 + 类型 name + 闸门 / 派生标）+ 描述脚注。
 * 派生环节虚线弱化；挂闸门加 amber 环 + 旗标角标。
 */
function StageNode({ data, selected }: NodeProps<FlowNodeT>) {
  const t = data.typeName ? stageType(data.typeName) : undefined;
  const label = t?.label ?? data.typeName ?? '';
  const Icon = t?.icon;
  const derived = t?.derived ?? false;
  const gate = !!data.gate;
  // 输出单项：已有出边则输出句柄不可再发起连接（拉不出线、无反应、不提示）。
  const hasOutgoing = useNodeConnections({ handleType: 'source' }).length > 0;
  return (
    <div
      className={cn(
        'relative w-56 cursor-grab rounded-xl border-2 bg-card shadow-sm transition-shadow active:cursor-grabbing',
        derived ? 'border-dashed border-border' : 'border-primary/40',
        selected && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background',
        gate && 'border-amber-400',
      )}
    >
      {/* 输入插槽（左）：不可牵出。 */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectableStart={false}
        style={INPUT_HANDLE_STYLE}
      />
      <div className="flex items-center gap-2.5 px-3 pb-2 pt-2.5">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            gate
              ? 'bg-amber-400/20 text-amber-600'
              : derived
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary/15 text-primary',
          )}
        >
          {Icon ? <Icon className="size-4" /> : <span className="size-2 rounded-full bg-current" />}
        </span>
        <div className="min-w-0 flex-1 text-left">
          <div
            className={cn(
              'truncate text-sm leading-tight',
              derived ? 'text-muted-foreground' : 'font-medium text-foreground',
            )}
          >
            {label}
          </div>
          <div className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
            {data.typeName}
          </div>
        </div>
        {gate ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
            <Flag className="size-2.5 fill-current" />
            闸门
          </span>
        ) : derived ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            派生
          </span>
        ) : null}
      </div>
      {t?.desc ? (
        <div className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {t.desc}
        </div>
      ) : null}
      {/* 输出插槽（右）：拉线起点，不可作落点；已有出边则不可再拉。 */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectableStart={!hasOutgoing}
        isConnectableEnd={false}
        style={OUTPUT_HANDLE_STYLE}
      />
    </div>
  );
}

/**
 * 起止哨兵节点：与环节卡同构的**块状卡片**，但更特殊 —— 实心 primary 图标章 + primary 实线描边 +
 * primary 浅底 + 半粗标题 + 「流程起点 / 流程终点」副标，区别于环节卡（细描边、浅底章）。
 * 起始只出（右 source）、结束只入（左 target），恒不可删。
 */
function TerminalNode({ data, selected }: NodeProps<FlowNodeT>) {
  const term = data.terminal ?? 'start';
  const isStart = term === 'start';
  const meta = TERMINAL_META[term];
  const Icon = meta.icon;
  // 输出单项：起始节点已有出边则不可再拉线（结束节点无输出，恒为空）。
  const hasOutgoing = useNodeConnections({ handleType: 'source' }).length > 0;
  return (
    <div
      className={cn(
        'relative flex w-44 cursor-grab items-center gap-2.5 rounded-xl border-2 border-primary bg-primary/5 px-3 py-2.5 shadow-sm transition-shadow active:cursor-grabbing',
        selected && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background',
      )}
    >
      {isStart ? null : (
        <Handle
          type="target"
          position={Position.Left}
          isConnectableStart={false}
          style={TERMINAL_HANDLE_STYLE}
        />
      )}
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold leading-tight text-foreground">
          {meta.label}
        </div>
        <div className="truncate text-[10px] leading-tight text-muted-foreground">
          {isStart ? '流程起点' : '流程终点'}
        </div>
      </div>
      {isStart ? (
        <Handle
          type="source"
          position={Position.Right}
          isConnectableStart={!hasOutgoing}
          isConnectableEnd={false}
          style={TERMINAL_HANDLE_STYLE}
        />
      ) : null}
    </div>
  );
}

const nodeTypes = { stage: StageNode, terminal: TerminalNode };

/**
 * 可删连线：smoothstep 边 + 中点删除按钮。按钮默认隐藏，**悬停线中点或选中该边时**浮出红色 ✕，
 * 点击即删此边（`deleteElements` 走受控 onEdgesChange，序列化回父）。
 * 另：选中边后 Delete/Backspace 也删；右键边走 onEdgeContextMenu 菜单。
 */
function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 14,
  });
  const show = hovered || !!selected;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {/* 中点悬停区（恒可交互、捕获 hover）；内部 ✕ 按钮按 show 浮现。 */}
        <div
          className="nodrag nopan pointer-events-auto absolute flex size-7 items-center justify-center"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            aria-label="删除连线"
            title="删除连线"
            onClick={(e) => {
              e.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
            className={cn(
              'flex size-5 items-center justify-center rounded-full border border-destructive bg-background text-destructive shadow-sm transition-all hover:bg-destructive/10',
              show ? 'scale-100 opacity-100' : 'pointer-events-none scale-50 opacity-0',
            )}
          >
            <X className="size-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { deletable: DeletableEdge };

/** FlowGraph → react-flow 节点 / 边（起止哨兵 → terminal 类型 + `deletable:false`）。 */
function toFlowNodes(flow: FlowGraph): FlowNodeT[] {
  return flow.nodes.map((n) =>
    isTerminal(n.type)
      ? {
          id: n.id,
          type: 'terminal',
          position: n.position,
          data: { terminal: n.type as 'start' | 'end' },
          deletable: false,
        }
      : {
          id: n.id,
          type: 'stage',
          position: n.position,
          data: { typeName: n.type, gate: !!n.gate },
        },
  );
}
function toFlowEdges(flow: FlowGraph): Edge[] {
  return flow.edges.map((e) => ({ ...DEFAULT_EDGE, id: e.id, source: e.source, target: e.target }));
}

/**
 * 是否存在「开始 → 结束」的有向连通路径（保存前校验：未连通禁止保存）。
 * 沿 edges（source → target）从开始节点广搜，能抵达结束节点即连通。
 */
function isStartEndConnected(flow: FlowGraph): boolean {
  const start = flow.nodes.find((n) => n.type === START_NODE);
  const end = flow.nodes.find((n) => n.type === END_NODE);
  if (!start || !end) return false;
  const adj = new Map<string, string[]>();
  for (const e of flow.edges) {
    const list = adj.get(e.source);
    if (list) list.push(e.target);
    else adj.set(e.source, [e.target]);
  }
  const seen = new Set<string>([start.id]);
  const stack = [start.id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (cur === end.id) return true;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/** 采集 / 复查参数 → 顶部信息条的紧凑文本块（与图纸表单同源语义，仅缩短标签）。 */
function paramChips(bp: Blueprint): string[] {
  if (bp.kind === 'collect') {
    const p = bp.params as CollectParams;
    return [`翻页 ${p.limit}`, `连命中 ${p.stopAfterKnown} 停`, `评论 ${p.commentBudget}`];
  }
  const p = bp.params as RecheckParams;
  return [`每批 ${p.batchSize}`, `冷却 ${p.batchIntervalSec}s`, `退避 ${p.backoffCap}`];
}

/** 顶部只读信息覆盖层：种类 + 数据源 + 参数。浮在画布上层、点击穿透（不挡平移 / 选节点）。 */
function InfoBar({ blueprint }: { blueprint: Blueprint }) {
  const kind = KIND_META[blueprint.kind];
  const KindIcon = kind.icon;
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card/85 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur">
      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground">
        <KindIcon className="size-3.5 text-primary" />
        {kind.label}
      </span>
      <span className="h-3 w-px shrink-0 bg-border" />
      {blueprint.sources.map((s) => {
        const SrcIcon = SOURCE_META[s.kind].icon;
        return (
          <span
            key={s.kind}
            className="inline-flex min-w-0 max-w-[220px] items-center gap-1 text-muted-foreground"
          >
            <SrcIcon className="size-3 shrink-0" />
            <span className="shrink-0 font-medium text-foreground">
              {SOURCE_META[s.kind].label}
            </span>
            {s.channels.length > 0 ? (
              <span className="truncate">{s.channels.join('、')}</span>
            ) : null}
          </span>
        );
      })}
      <span className="h-3 w-px shrink-0 bg-border" />
      {paramChips(blueprint).map((c) => (
        <span key={c} className="shrink-0 text-muted-foreground">
          {c}
        </span>
      ))}
    </div>
  );
}

/** 浮动「创建菜单」：输出拖放 / 空白右键唤起；列出当前 kind 可用环节（带专属图标）。 */
function CreateMenu({
  x,
  y,
  connect,
  palette,
  onPick,
}: {
  x: number;
  y: number;
  /** true = 由输出拖放唤起，选中后会连线；false = 空白右键，仅建节点。 */
  connect: boolean;
  palette: StageType[];
  onPick: (typeName: string) => void;
}) {
  return (
    <div
      className="absolute z-30 w-56 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
        {connect ? '连接到新环节' : '新增环节'}
      </div>
      <div className="max-h-[240px] overflow-y-auto">
        {palette.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.name}
              type="button"
              title={t.desc}
              onClick={() => onPick(t.name)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-md',
                  t.derived ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">{t.label}</span>
              {t.derived ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">派生</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 浮动「节点菜单」：节点右键唤起；挂 / 摘闸门、删除。
 * `gate===null` 表示该节点不可挂闸门（起止哨兵）→ 不显示闸门项；`deletable=false` → 删除项禁用。
 */
function NodeMenu({
  x,
  y,
  gate,
  deletable,
  onToggleGate,
  onDelete,
}: {
  x: number;
  y: number;
  gate: boolean | null;
  deletable: boolean;
  onToggleGate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="absolute z-30 w-44 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      {gate !== null ? (
        <button
          type="button"
          onClick={onToggleGate}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Flag className={cn('size-3.5', gate && 'fill-current text-amber-500')} />
          {gate ? '摘除闸门' : '挂闸门'}
        </button>
      ) : null}
      {!deletable ? (
        <div className="px-2 py-1.5 text-[11px] text-muted-foreground">起止节点 · 不可删除</div>
      ) : null}
      <button
        type="button"
        disabled={!deletable}
        onClick={deletable ? onDelete : undefined}
        title={deletable ? undefined : '起止节点不可删除'}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          deletable
            ? 'text-destructive hover:bg-destructive/10'
            : 'cursor-not-allowed text-muted-foreground opacity-60',
        )}
      >
        <Trash2 className="size-3.5" />
        删除节点
      </button>
    </div>
  );
}

/** 浮动「连线菜单」：连线右键唤起；删除该连线。 */
function EdgeMenu({ x, y, onDelete }: { x: number; y: number; onDelete: () => void }) {
  return (
    <div
      className="absolute z-30 w-40 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
      >
        <Trash2 className="size-3.5" />
        删除连线
      </button>
    </div>
  );
}

/** 创建菜单态：x/y = 相对画布的落点（已夹取防越界）；flow = 画布坐标（建节点用）；sourceId = 连线起点节点（null 则不连线）。 */
interface CreateMenuState {
  x: number;
  y: number;
  flow: { x: number; y: number };
  sourceId: string | null;
}
/** 节点菜单态。 */
interface NodeMenuState {
  x: number;
  y: number;
  nodeId: string;
}
/** 连线菜单态。 */
interface EdgeMenuState {
  x: number;
  y: number;
  edgeId: string;
}

function FlowCanvas({
  blueprint,
  value,
  onChange,
  fullscreen,
  onToggleFullscreen,
  dirty,
  connected,
  saving,
  onSave,
  onReset,
}: {
  blueprint: Blueprint;
  value: FlowGraph;
  onChange: (flow: FlowGraph) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  dirty: boolean;
  connected: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeT>(toFlowNodes(value));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(value));
  const [menu, setMenu] = useState<CreateMenuState | null>(null);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const { resolvedTheme } = useTheme();

  const palette = useMemo(() => stageTypesForKind(blueprint.kind), [blueprint.kind]);

  // 画布变更 → 序列化回父（onChange = setDraft，稳定）。position（坐标）/gate/连线 都在此收口。
  useEffect(() => {
    onChange({
      nodes: nodes.map((n) =>
        n.data.terminal
          ? { id: n.id, type: n.data.terminal, position: n.position }
          : {
              id: n.id,
              type: n.data.typeName ?? '',
              position: n.position,
              ...(n.data.gate ? { gate: true } : {}),
            },
      ),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    });
  }, [nodes, edges, onChange]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (params.source === params.target) return; // 防自环
      setEdges((eds) => addEdge({ ...DEFAULT_EDGE, ...params }, eds));
    },
    [setEdges],
  );

  /**
   * 连接合法性：**输入单项** —— target 已有入边 → 拒；自环 → 拒。无效目标 react-flow 会标红、松手不连。
   * 输出单项不在此判（已由输出句柄 `isConnectableStart={!hasOutgoing}` 在源头拦掉：拉不出线）。
   */
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (c.source === c.target) return false;
      if (edges.some((e) => e.target === c.target)) return false; // 输入单项
      return true;
    },
    [edges],
  );

  /** 屏幕坐标 → { 相对画布落点（夹取防越界，菜单宽 w 高 h）, 画布坐标 flow }。 */
  const locate = useCallback(
    (clientX: number, clientY: number, w: number, h: number) => {
      const flow = screenToFlowPosition({ x: clientX, y: clientY });
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return { x: 8, y: 8, flow };
      const x = Math.max(8, Math.min(clientX - rect.left, rect.width - w - 8));
      const y = Math.max(8, Math.min(clientY - rect.top, rect.height - h - 8));
      return { x, y, flow };
    },
    [screenToFlowPosition],
  );

  // 从输出拖线松手：落在有效输入上 → onConnect 已建边；落在某节点上但无效 → 不处理；落在空白 → 弹创建菜单。
  const onConnectEnd = useCallback(
    (event: globalThis.MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid) return; // 已连到有效输入
      if (connectionState.toNode) return; // 落在某节点上但无效（输入已占用 / 方向不符）→ 不建节点
      // 能发起拖拽的输出必为空闲（占用的输出句柄已禁连），故落空白即可放心建节点 + 连线。
      const fromId = connectionState.fromNode?.id ?? null;
      if (!fromId) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!point) return;
      const pos = locate(point.clientX, point.clientY, 224, 240);
      setNodeMenu(null);
      setEdgeMenu(null);
      setMenu({ ...pos, sourceId: fromId });
    },
    [locate],
  );

  // 空白右键：弹创建菜单，仅建节点（不连线）。
  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | globalThis.MouseEvent) => {
      event.preventDefault();
      const pos = locate(event.clientX, event.clientY, 224, 240);
      setNodeMenu(null);
      setEdgeMenu(null);
      setMenu({ ...pos, sourceId: null });
    },
    [locate],
  );

  // 节点右键：弹节点菜单（挂 / 摘闸门、删除）。
  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: FlowNodeT) => {
      event.preventDefault();
      const pos = locate(event.clientX, event.clientY, 176, 116);
      setMenu(null);
      setEdgeMenu(null);
      setNodeMenu({ x: pos.x, y: pos.y, nodeId: node.id });
    },
    [locate],
  );

  // 连线右键：弹连线菜单（删除连线）。
  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      event.preventDefault();
      const pos = locate(event.clientX, event.clientY, 160, 56);
      setMenu(null);
      setNodeMenu(null);
      setEdgeMenu({ x: pos.x, y: pos.y, edgeId: edge.id });
    },
    [locate],
  );

  /** 创建菜单选中环节：在落点建 stage 节点；若由输出拖放唤起，则把线接上。 */
  const createNode = useCallback(
    (typeName: string) => {
      const m = menu;
      if (!m) return;
      idRef.current += 1;
      const id = `${typeName}_${idRef.current}`;
      setNodes((ns) =>
        ns.concat({ id, type: 'stage', position: m.flow, data: { typeName, gate: false } }),
      );
      if (m.sourceId) {
        const src = m.sourceId;
        setEdges((es) =>
          addEdge({ ...DEFAULT_EDGE, id: `e_${src}_${id}`, source: src, target: id }, es),
        );
      }
      setMenu(null);
    },
    [menu, setNodes, setEdges],
  );

  const toggleGate = useCallback(
    (id: string) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, gate: !n.data.gate } } : n)),
      );
      setNodeMenu(null);
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id);
      if (target?.data.terminal) return; // 起止哨兵不可删
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setNodeMenu(null);
    },
    [nodes, setNodes, setEdges],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setEdges((es) => es.filter((e) => e.id !== id));
      setEdgeMenu(null);
    },
    [setEdges],
  );

  const menuNode = nodeMenu ? nodes.find((n) => n.id === nodeMenu.nodeId) : undefined;
  const menuTerminal = !!menuNode?.data.terminal;

  return (
    <div
      ref={wrapperRef}
      className="relative h-full min-h-[380px] w-full overflow-hidden rounded-lg border bg-muted/20"
    >
      <ReactFlow
        colorMode={resolvedTheme}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        defaultEdgeOptions={DEFAULT_EDGE}
        connectionLineType={ConnectionLineType.SmoothStep}
        deleteKeyCode={['Backspace', 'Delete']}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.24 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="var(--border)" />
      </ReactFlow>

      {/* 左上：数据源 / 参数信息（点击穿透、不挡画布；限宽避让右上控件）。 */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-11rem)]">
        <InfoBar blueprint={blueprint} />
      </div>

      {/* 右上：缩放 + 全屏（悬浮控件，参考运行详情布局）。 */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border bg-card/90 p-1 backdrop-blur-sm">
        <Button size="icon-sm" variant="ghost" aria-label="缩小" onClick={() => void zoomOut()}>
          <ZoomOut className="size-4" />
        </Button>
        <button
          type="button"
          onClick={() => void fitView({ padding: 0.24 })}
          className="min-w-12 rounded px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground"
          aria-label="适应视图（缩放至全图可见）"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button size="icon-sm" variant="ghost" aria-label="放大" onClick={() => void zoomIn()}>
          <ZoomIn className="size-4" />
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={fullscreen ? '退出全屏' : '全屏'}
          title={fullscreen ? '退出全屏（Esc）' : '全屏编辑'}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      </div>

      {/* 左下：操作提示（默认收起为 Info 按钮，点开淡入上移展开）。 */}
      {hintOpen ? (
        <div className="absolute bottom-3 left-3 z-10 flex max-w-[min(100%-1.5rem,42rem)] items-start gap-2 rounded-lg border bg-card/90 px-3 py-2 text-xs leading-relaxed text-muted-foreground backdrop-blur-sm duration-200 animate-in fade-in slide-in-from-bottom-1">
          <span className="flex-1">
            从节点右侧「输出」拖线松手即选环节接上 · 右键空白处新增环节 · 右键节点挂闸门 / 删除 ·
            连线中点 ✕ 或右键连线删除 · 输入 / 输出各限一条 · 起止节点不可删 ·
            「开始」须连通到「结束」方可保存 · 改动需手动保存（右下角）
          </span>
          <button
            type="button"
            aria-label="收起操作提示"
            className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            onClick={() => setHintOpen(false)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-label="操作提示"
          title="操作提示"
          className="absolute bottom-3 left-3 z-10 inline-flex size-8 items-center justify-center rounded-lg border bg-card/90 text-muted-foreground backdrop-blur-sm hover:text-foreground"
          onClick={() => setHintOpen(true)}
        >
          <Info className="size-4" />
        </button>
      )}

      {/* 右下：保存 / 重置（仅有未保存改动时出现，主动触发）。 */}
      {dirty ? (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-lg border bg-card/95 p-1.5 pl-3 shadow-md backdrop-blur-sm duration-200 animate-in fade-in slide-in-from-bottom-1">
          {connected ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-amber-500" />
              未保存
            </span>
          ) : (
            <span
              className="flex items-center gap-1.5 text-xs font-medium text-destructive"
              title="「开始」未连通到「结束」，无法保存"
            >
              <span className="size-1.5 rounded-full bg-destructive" />
              未连通
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={onReset} disabled={saving}>
            <RotateCcw className="size-3.5" />
            重置
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            <Save className="size-3.5" />
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      ) : null}

      {/* 创建菜单（输出拖放 / 空白右键）：全画布透明背板兜底点击 / 右键关闭。 */}
      {menu ? (
        <>
          <div
            className="absolute inset-0 z-20"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <CreateMenu
            x={menu.x}
            y={menu.y}
            connect={menu.sourceId !== null}
            palette={palette}
            onPick={createNode}
          />
        </>
      ) : null}

      {/* 节点菜单（节点右键）。 */}
      {nodeMenu && menuNode ? (
        <>
          <div
            className="absolute inset-0 z-20"
            onClick={() => setNodeMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setNodeMenu(null);
            }}
          />
          <NodeMenu
            x={nodeMenu.x}
            y={nodeMenu.y}
            gate={menuTerminal ? null : !!menuNode.data.gate}
            deletable={!menuTerminal}
            onToggleGate={() => toggleGate(menuNode.id)}
            onDelete={() => deleteNode(menuNode.id)}
          />
        </>
      ) : null}

      {/* 连线菜单（连线右键）。 */}
      {edgeMenu ? (
        <>
          <div
            className="absolute inset-0 z-20"
            onClick={() => setEdgeMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setEdgeMenu(null);
            }}
          />
          <EdgeMenu x={edgeMenu.x} y={edgeMenu.y} onDelete={() => deleteEdge(edgeMenu.edgeId)} />
        </>
      ) : null}
    </div>
  );
}

/** 图纸流程连线编辑器（外层提供 ReactFlowProvider，内层用 useReactFlow）。 */
export function FlowEditor(props: {
  blueprint: Blueprint;
  value: FlowGraph;
  onChange: (flow: FlowGraph) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  dirty: boolean;
  connected: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}

/**
 * 内联流程编辑器 —— 详情页执行流程区直接编辑，支持「全屏编辑」。
 * - 默认占据一块大画布（视口高自适应）；全屏经画布右上角缩放药丸里的全屏按钮切换到整屏覆盖层
 *   （纯全画布、无独立头部栏，所有控件悬浮其上），支持 Esc 退出、自动锁背景滚动。
 * - **保存为主动触发**：画布改动经 `onChange` 实时同步到本地 `draft`；与已存 flow 不一致即 `dirty`，
 *   右下角浮出「保存 / 重置」。保存把 draft（**含坐标**）写回 mock；重置丢弃 draft 并经 `resetSeq`
 *   重挂画布回到已存态。切换图纸 / 全屏 / 重置都用 `key` 强制重挂、从 value 重新初始化。
 */
export function InlineFlowEditor({ blueprint }: { blueprint: Blueprint }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<FlowGraph>(blueprint.flow);
  const [fullscreen, setFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetSeq, setResetSeq] = useState(0);

  const dirty = JSON.stringify(draft) !== JSON.stringify(blueprint.flow);
  const connected = isStartEndConnected(draft);

  const handleChange = useCallback((flow: FlowGraph) => setDraft(flow), []);

  const onSave = useCallback(() => {
    if (!isStartEndConnected(draft)) {
      toast.error('「开始」未连通到「结束」', {
        description: '请把流程从「开始」一路连到「结束」，再保存。',
      });
      return;
    }
    setSaving(true);
    void mockApi
      .updateBlueprint(blueprint.id, { flow: draft })
      .then(() => qc.invalidateQueries({ queryKey: KEYS.blueprints }))
      .finally(() => setSaving(false));
  }, [blueprint.id, draft, qc]);

  const onReset = useCallback(() => {
    setDraft(blueprint.flow);
    setResetSeq((s) => s + 1); // 重挂画布 → 从已存 flow 重新初始化
  }, [blueprint.flow]);

  // 全屏：Esc 退出 + 锁背景滚动。
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  // key 随全屏 / 重置变 → 重挂 + fitView 适配新尺寸 / 回到已存态；value=draft 故切全屏不丢改动。
  const canvas = (
    <FlowEditor
      key={`${fullscreen ? 'fs' : 'inline'}-${resetSeq}`}
      blueprint={blueprint}
      value={draft}
      onChange={handleChange}
      fullscreen={fullscreen}
      onToggleFullscreen={() => setFullscreen((v) => !v)}
      dirty={dirty}
      connected={connected}
      saving={saving}
      onSave={onSave}
      onReset={onReset}
    />
  );

  if (fullscreen) {
    return <div className="fixed inset-0 z-50 bg-background">{canvas}</div>;
  }

  return <div className="h-[68vh] max-h-[680px] min-h-[460px] w-full">{canvas}</div>;
}
