import { useEffect } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
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
import { cn } from '@hatch-radar/ui/lib/utils';

/** 任务环节（与进程详情同源；图节点只取状态做进度点，不取产物） */
export interface GraphStage {
  seq: number;
  name: string;
  status: string;
  gate: boolean;
}

/** 图节点对应的任务（进程详情 tasks 的子集 + 血缘父指针） */
export interface GraphTask {
  id: number;
  kind: string;
  status: string;
  parentTaskId: number | null;
  postId: string | null;
  model: string | null;
  stages: GraphStage[];
}

/** 任务 kind 的中文短名 + 单字标 */
const KIND_META: Record<string, { label: string; tag: string }> = {
  discover: { label: '发现', tag: '发' },
  collect: { label: '采集', tag: '采' },
  recheck: { label: '复查', tag: '查' },
  analyze: { label: '分析', tag: '析' },
  translate: { label: '翻译', tag: '译' },
};

/** 列间距 / 行间距（卡片宽 ~192） */
const COL_GAP = 248;
const ROW_GAP = 96;

interface NodeData extends Record<string, unknown> {
  task: GraphTask;
  selected: boolean;
  onSelect: (id: number) => void;
}
type TaskFlowNode = Node<NodeData, 'task'>;

/** 卡片边框 + 阴影（按任务状态）。 */
function cardClass(status: string, selected: boolean): string {
  const base =
    'flex w-48 flex-col gap-1.5 rounded-xl border-2 bg-card px-3 py-2.5 shadow-sm transition-all duration-300';
  const ring = selected ? ' ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : '';
  switch (status) {
    case 'running':
      return `${base} border-primary shadow-[0_0_20px_-3px_var(--primary)]${ring}`;
    case 'paused':
      return `${base} border-primary/55 border-dashed${ring}`;
    case 'succeeded':
      return `${base} border-primary/40${ring}`;
    case 'failed':
      return `${base} border-destructive/70 shadow-[0_0_16px_-5px_var(--destructive)]${ring}`;
    case 'canceled':
    case 'skipped':
      return `${base} border-border opacity-70${ring}`;
    default:
      return `${base} border-border${ring}`;
  }
}

/** 单字 kind 标的底色（按状态弱化）。 */
function tagClass(status: string): string {
  const base =
    'flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold';
  switch (status) {
    case 'running':
      return `${base} bg-primary text-primary-foreground`;
    case 'failed':
      return `${base} bg-destructive/15 text-destructive`;
    case 'succeeded':
      return `${base} bg-primary/15 text-primary`;
    default:
      return `${base} bg-muted text-muted-foreground`;
  }
}

const STAGE_DOT: Record<string, string> = {
  pending: 'bg-muted-foreground/30',
  running: 'bg-primary animate-pulse',
  done: 'bg-primary',
  skipped: 'bg-muted-foreground/25',
  failed: 'bg-destructive',
};

const STATUS_LABEL: Record<string, string> = {
  queued: '排队',
  running: '运行中',
  paused: '暂停',
  succeeded: '成功',
  skipped: '略过',
  failed: '失败',
  canceled: '已取消',
};

const HANDLE_STYLE = {
  width: 8,
  height: 8,
  background: 'var(--muted-foreground)',
  border: '2px solid var(--background)',
} as const;

/** 任务节点卡：kind 标 + 状态 + 帖子 id + 环节进度点。 */
function TaskNode({ data }: NodeProps<TaskFlowNode>) {
  const { task, selected, onSelect } = data;
  const kind = KIND_META[task.kind] ?? { label: task.kind, tag: '?' };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(task.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(task.id)}
      className={cn('cursor-pointer select-none', cardClass(task.status, selected))}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={HANDLE_STYLE} />
      <div className="flex items-center gap-2">
        <span className={tagClass(task.status)}>{kind.tag}</span>
        <span className="text-sm font-medium leading-tight">{kind.label}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>
      <div className="truncate font-mono text-[11px] text-muted-foreground">
        {task.postId ?? '—'}
      </div>
      {task.stages.length > 0 ? (
        <div className="flex items-center gap-1">
          {task.stages.map((s) => (
            <span
              key={s.seq}
              className={cn('size-1.5 rounded-full', STAGE_DOT[s.status] ?? STAGE_DOT.pending)}
              title={`${s.name}: ${s.status}${s.gate ? ' · 闸门' : ''}`}
            />
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={false} style={HANDLE_STYLE} />
    </div>
  );
}

const nodeTypes = { task: TaskNode };

/** 血缘深度（从根任务起 0；按 parentTaskId 上溯，带环保护）。 */
function depthOf(task: GraphTask, byId: Map<number, GraphTask>): number {
  let depth = 0;
  let cur: GraphTask | undefined = task;
  const seen = new Set<number>();
  while (cur?.parentTaskId != null && byId.has(cur.parentTaskId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth += 1;
    cur = byId.get(cur.parentTaskId);
  }

  return depth;
}

function buildGraph(
  tasks: GraphTask[],
  selectedId: number | null,
  onSelect: (id: number) => void,
): { nodes: TaskFlowNode[]; edges: Edge[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // 按深度分列、列内顺序堆叠成行（同深度递增 y），左→右呈血缘级联
  const rowByDepth = new Map<number, number>();
  const nodes: TaskFlowNode[] = tasks.map((task) => {
    const depth = depthOf(task, byId);
    const row = rowByDepth.get(depth) ?? 0;
    rowByDepth.set(depth, row + 1);

    return {
      id: String(task.id),
      type: 'task' as const,
      position: { x: depth * COL_GAP, y: row * ROW_GAP },
      data: { task, selected: task.id === selectedId, onSelect },
      draggable: false,
    };
  });
  const edges: Edge[] = [];
  for (const t of tasks) {
    if (t.parentTaskId != null && byId.has(t.parentTaskId)) {
      edges.push({
        id: `e-${t.parentTaskId}-${t.id}`,
        source: String(t.parentTaskId),
        target: String(t.id),
        type: 'default',
        animated: t.status === 'running',
        style: { stroke: 'var(--border)', strokeWidth: 2 },
      });
    }
  }

  return { nodes, edges };
}

/**
 * 进程任务血缘流程图（react-flow）：节点 = 任务（kind/状态/帖子/环节进度点），
 * 边 = 父→子血缘（discover→collect→analyze 的级联），按深度分列布局。
 * 与定长的检视流程图（{@link FlowDiagram}）不同——这里可拖拽平移 / 缩放（任务多时导航），
 * 点选节点把详情交回上层（见 pipeline-detail 的选中任务面板）。
 */
export function RunGraph({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: GraphTask[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const g = buildGraph(tasks, selectedId, onSelect);
    setNodes(g.nodes);
    setEdges(g.edges);
  }, [tasks, selectedId, onSelect, setNodes, setEdges]);

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-lg border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
