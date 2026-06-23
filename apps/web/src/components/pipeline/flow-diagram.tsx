import { useEffect } from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, Loader2, X } from 'lucide-react';
import {
  INSPECT_STEP_LABELS,
  type InspectStepName,
  type InspectStepView,
} from '@hatch-radar/shared';
import { cn } from '@hatch-radar/ui/lib/utils';

/** 节点水平间距（卡片宽 ~176，留出贝塞尔曲线空间） */
const NODE_GAP = 232;

/** 自定义节点携带的数据 */
interface NodeData extends Record<string, unknown> {
  step: InspectStepView;
  selected: boolean;
  index: number;
  onSelect: (seq: number) => void;
}
type InspectFlowNode = Node<NodeData, 'inspect'>;

/** 节点耗时（秒，整数）。时间戳为整数秒，毫秒级节点显示「0s」。 */
function stepDuration(s: InspectStepView): string | null {
  if (s.startedAt == null || s.finishedAt == null) {
    return null;
  }
  return `${Math.max(0, s.finishedAt - s.startedAt)}s`;
}

/** 卡片边框 + 阴影（按状态；含 transition，状态切换平滑过渡不闪现）。 */
function cardClass(status: string, selected: boolean): string {
  const base =
    'flex w-44 items-center gap-3 rounded-xl border-2 bg-card px-3 py-2.5 shadow-sm transition-all duration-500 ease-out';
  const ring = selected ? ' ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : '';
  switch (status) {
    case 'running':
      // 当前节点：高亮边框 + primary 辉光，最醒目
      return `${base} border-primary shadow-[0_0_22px_-2px_var(--primary)]${ring}`;
    case 'done':
      return `${base} border-primary/40${ring}`;
    case 'failed':
      return `${base} border-destructive/70 shadow-[0_0_18px_-4px_var(--destructive)]${ring}`;
    default:
      return `${base} border-border${ring}`;
  }
}

/** 状态图标圆。 */
function iconClass(status: string): string {
  const base =
    'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-500';
  switch (status) {
    case 'running':
      return `${base} bg-primary text-primary-foreground`;
    case 'done':
      return `${base} bg-primary/15 text-primary`;
    case 'failed':
      return `${base} bg-destructive/15 text-destructive`;
    default:
      return `${base} bg-muted text-muted-foreground`;
  }
}

/** 副文本：running「运行中…」/ done 耗时 / failed「失败」/ pending「待执行」。 */
function subLabel(step: InspectStepView): string {
  if (step.status === 'running') {
    return '运行中…';
  }
  if (step.status === 'failed') {
    return '失败';
  }
  if (step.status === 'done') {
    return stepDuration(step) ?? '完成';
  }
  return '待执行';
}

/** 可见连接点（react-flow 节点图标志），用主题色描边的小圆点。 */
const HANDLE_STYLE = {
  width: 9,
  height: 9,
  background: 'var(--muted-foreground)',
  border: '2px solid var(--background)',
} as const;

/** 自绘流水线节点——卡片（图标 + 标题 + 状态），带左右连接点。 */
function InspectNode({ data }: NodeProps<InspectFlowNode>) {
  const { step, selected, index, onSelect } = data;
  const label = INSPECT_STEP_LABELS[step.name as InspectStepName] ?? step.name;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(step.seq)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(step.seq)}
      className={cn('cursor-pointer select-none', cardClass(step.status, selected))}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={HANDLE_STYLE} />
      <span className={iconClass(step.status)}>
        {step.status === 'done' ? (
          <Check className="size-4" />
        ) : step.status === 'failed' ? (
          <X className="size-4" />
        ) : step.status === 'running' ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <span className="text-sm font-semibold">{index + 1}</span>
        )}
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div
          className={cn(
            'truncate text-sm leading-tight transition-colors duration-500',
            step.status === 'pending' ? 'text-muted-foreground' : 'font-medium text-foreground',
          )}
        >
          {label}
        </div>
        <div className="text-[11px] leading-tight tabular-nums text-muted-foreground">
          {subLabel(step)}
        </div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} style={HANDLE_STYLE} />
    </div>
  );
}

const nodeTypes = { inspect: InspectNode };

function buildNodes(
  steps: InspectStepView[],
  selectedSeq: number,
  onSelect: (seq: number) => void,
): InspectFlowNode[] {
  return steps.map((step, index) => ({
    id: String(step.seq),
    type: 'inspect',
    position: { x: index * NODE_GAP, y: 0 },
    data: { step, selected: step.seq === selectedSeq, index, onSelect },
    draggable: false,
  }));
}

function buildEdges(steps: InspectStepView[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const done = steps[i]!.status === 'done';
    const flowing = done && steps[i + 1]!.status === 'running'; // 正流向当前节点 → 流动动画
    edges.push({
      id: `e-${steps[i]!.seq}-${steps[i + 1]!.seq}`,
      source: String(steps[i]!.seq),
      target: String(steps[i + 1]!.seq),
      type: 'default', // 贝塞尔曲线
      animated: flowing,
      style: {
        stroke: done ? 'var(--primary)' : 'var(--border)',
        strokeWidth: 2,
        transition: 'stroke 0.4s ease',
      },
    });
  }
  return edges;
}

/**
 * 节点图式管道线路图（react-flow）：卡片节点（图标 + 标题 + 状态）+ 贝塞尔曲线 + 可见连接点 +
 * 点阵画布背景，呈现真正的「图」表现而非线性步骤条。固定布局、禁拖拽缩放。
 * 节点状态用 CSS transition 平滑过渡（轮询刷新不闪现）；正流向当前节点的边用流动动画，
 * 视觉上看得出从哪一步推进到哪一步；当前节点 primary 辉光最醒目。
 */
export function FlowDiagram({
  steps,
  selectedSeq,
  onSelect,
}: {
  steps: InspectStepView[];
  selectedSeq: number;
  onSelect: (seq: number) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<InspectFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // steps / 选中变化时同步——节点 id 稳定（=seq），react-flow 复用 DOM，故 className 切换触发过渡
  useEffect(() => {
    setNodes(buildNodes(steps, selectedSeq, onSelect));
    setEdges(buildEdges(steps));
  }, [steps, selectedSeq, onSelect, setNodes, setEdges]);

  return (
    <div className="h-48 w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        minZoom={0.3}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }} // 内部工具，隐去角标
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="var(--border)" />
      </ReactFlow>
    </div>
  );
}
