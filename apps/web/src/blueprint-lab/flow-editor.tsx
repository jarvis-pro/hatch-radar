/**
 * 图纸流程连线编辑器（react-flow，可编辑 DAG）—— 取代写死的「固定环节模板」。
 *
 * - **节点池**（左上 Panel）：当前 kind 可用的环节类型，点击加入画布。
 * - **画布**：节点可拖拽定位、可从右连接点拖到下个节点的左连接点连线（支持分支 / 合并 / 并行）、可缩放平移。
 * - **工具栏**（右上 Panel）：选中节点后可「挂 / 摘闸门」「删除」；也支持 Delete / Backspace 键删除。
 *
 * 受控：`value` 仅在挂载时初始化内部画布状态（编辑期间画布自管，避免父回传造成循环）；
 * 任何变更经 `onChange` 回传序列化后的 {@link FlowGraph}，由父保存。切换图纸用 `key` 强制重挂即可重置。
 * 节点 `type` 必须是执行内核认识的环节（见 STAGE_TYPES），否则后端跑不了。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Flag, Maximize2, Minimize2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@hatch-radar/ui/components/drawer';
import { toast } from '@hatch-radar/ui/components/sonner';
import { useTheme } from '@hatch-radar/ui/components/theme-provider';
import { cn } from '@hatch-radar/ui/lib/utils';
import { stageType, stageTypesForKind } from './constants';
import { mockApi } from './mock';
import type { Blueprint, BlueprintKind, FlowGraph } from './types';
import { KEYS } from './util';

/** react-flow 自定义节点携带的数据（纯数据，操作走工具栏 → 无回调闭包同步问题）。 */
interface StageNodeData extends Record<string, unknown> {
  /** 环节类型 name（STAGE_TYPES.name）。 */
  typeName: string;
  /** 是否挂闸门。 */
  gate: boolean;
}
type StageFlowNode = Node<StageNodeData, 'stage'>;

/** 可见连接点：主题色描边小圆。编辑态可连，故 isConnectable 默认开。 */
const HANDLE_STYLE = {
  width: 10,
  height: 10,
  background: 'var(--primary)',
  border: '2px solid var(--background)',
} as const;

/** 新边默认样式：primary 贝塞尔 + 箭头（DAG 有向）。onConnect 新建的边自动套用。 */
const DEFAULT_EDGE = {
  type: 'default',
  markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--primary)', width: 18, height: 18 },
  style: { stroke: 'var(--primary)', strokeWidth: 2 },
};

/** 环节节点卡片：标题 + 类型名；派生环节虚线弱化，挂闸门加 amber 环 + 角标。 */
function StageNode({ data, selected }: NodeProps<StageFlowNode>) {
  const t = stageType(data.typeName);
  const label = t?.label ?? data.typeName;
  const derived = t?.derived ?? false;
  return (
    <div
      className={cn(
        'relative flex w-44 cursor-grab items-center gap-2.5 rounded-xl border-2 bg-card px-3 py-2.5 shadow-sm transition-shadow active:cursor-grabbing',
        derived ? 'border-dashed border-border' : 'border-primary/40',
        selected && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background',
        data.gate && 'border-amber-400',
      )}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          data.gate
            ? 'bg-amber-400/20 text-amber-600'
            : derived
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary/15 text-primary',
        )}
      >
        {data.gate ? (
          <Flag className="size-3.5 fill-current" />
        ) : (
          <span className="size-2 rounded-full bg-current" />
        )}
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
          {derived ? '派生 · ' : ''}
          {data.typeName}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  );
}

const nodeTypes = { stage: StageNode };

/** FlowGraph → react-flow 节点 / 边。 */
function toFlowNodes(flow: FlowGraph): StageFlowNode[] {
  return flow.nodes.map((n) => ({
    id: n.id,
    type: 'stage',
    position: n.position,
    data: { typeName: n.type, gate: !!n.gate },
  }));
}
function toFlowEdges(flow: FlowGraph): Edge[] {
  return flow.edges.map((e) => ({ ...DEFAULT_EDGE, id: e.id, source: e.source, target: e.target }));
}

function FlowCanvas({
  kind,
  value,
  onChange,
}: {
  kind: BlueprintKind;
  value: FlowGraph;
  onChange: (flow: FlowGraph) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<StageFlowNode>(toFlowNodes(value));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(value));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const { screenToFlowPosition } = useReactFlow();
  const { resolvedTheme } = useTheme();

  const palette = useMemo(() => stageTypesForKind(kind), [kind]);

  // 画布变更 → 序列化回父（onChange = setDraft，稳定）。position/gate/连线 都在此收口。
  useEffect(() => {
    onChange({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.typeName,
        position: n.position,
        ...(n.data.gate ? { gate: true } : {}),
      })),
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

  /** 从节点池加一个环节：落在画布中心，避免叠在角落。 */
  const addNode = useCallback(
    (typeName: string) => {
      idRef.current += 1;
      const rect = wrapperRef.current?.getBoundingClientRect();
      const position = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 };
      setNodes((ns) =>
        ns.concat({
          id: `${typeName}_${idRef.current}`,
          type: 'stage',
          position,
          data: { typeName, gate: false },
        }),
      );
    },
    [screenToFlowPosition, setNodes],
  );

  const hasNodeSel = nodes.some((n) => n.selected);
  const hasSel = hasNodeSel || edges.some((e) => e.selected);

  /** 选中节点：切换闸门（挂 ⇄ 摘）。 */
  const toggleGate = useCallback(() => {
    setNodes((ns) =>
      ns.map((n) => (n.selected ? { ...n, data: { ...n.data, gate: !n.data.gate } } : n)),
    );
  }, [setNodes]);

  /** 删除选中的节点（连带其边）与选中的边。 */
  const deleteSelected = useCallback(() => {
    setNodes((ns) => {
      const dead = new Set(ns.filter((n) => n.selected).map((n) => n.id));
      setEdges((es) => es.filter((e) => !e.selected && !dead.has(e.source) && !dead.has(e.target)));
      return ns.filter((n) => !n.selected);
    });
  }, [setNodes, setEdges]);

  return (
    <div
      ref={wrapperRef}
      className="h-full min-h-[380px] w-full overflow-hidden rounded-lg border bg-muted/20"
    >
      <ReactFlow
        colorMode={resolvedTheme}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultEdgeOptions={DEFAULT_EDGE}
        connectionLineType={ConnectionLineType.Bezier}
        deleteKeyCode={['Backspace', 'Delete']}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="var(--border)" />
        <Controls showInteractive={false} />

        <Panel position="top-left">
          <div className="w-44 rounded-lg border bg-card/95 p-2 shadow-sm backdrop-blur">
            <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
              环节 · 点击加入
            </div>
            <div className="flex flex-col gap-0.5">
              {palette.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  title={t.desc}
                  onClick={() => addNode(t.name)}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel position="top-right">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!hasNodeSel} onClick={toggleGate}>
              <Flag className="size-3.5" /> 挂 / 摘闸门
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSel}
              onClick={deleteSelected}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> 删除
            </Button>
          </div>
        </Panel>

        <Panel position="bottom-center">
          <p className="rounded-md bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            拖动节点排布 · 从右侧连接点拖到下个节点的左侧连接点连线 · 选中节点可挂闸门或删除
          </p>
        </Panel>
      </ReactFlow>
    </div>
  );
}

/** 图纸流程连线编辑器（外层提供 ReactFlowProvider，内层用 useReactFlow）。 */
export function FlowEditor(props: {
  kind: BlueprintKind;
  value: FlowGraph;
  onChange: (flow: FlowGraph) => void;
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}

/** 每次「打开」自增的 key —— 强制编辑器重挂、从 value 重新初始化（草稿不残留上次未保存的改动）。 */
function useOpenKey(open: boolean): number {
  const [key, setKey] = useState(0);
  const [was, setWas] = useState(false);
  if (open !== was) {
    setWas(open);
    if (open) setKey((k) => k + 1);
  }
  return key;
}

/**
 * 流程编辑器抽屉（底部全宽大画布）—— 详情页「编辑流程」按钮打开。
 * 自带保存：写回 mock + 失效图纸查询 + toast；取消即丢弃草稿（下次打开从已存流程重来）。
 */
export function FlowEditorDrawer({
  open,
  onOpenChange,
  blueprint,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blueprint: Blueprint;
}) {
  const qc = useQueryClient();
  const bodyKey = useOpenKey(open);
  const [draft, setDraft] = useState<FlowGraph>(blueprint.flow);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(blueprint.flow);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await mockApi.updateBlueprint(blueprint.id, { flow: draft });
      await qc.invalidateQueries({ queryKey: KEYS.blueprints });
      toast.success('流程已保存');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
      <DrawerContent className="h-[88vh]">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden">
          <DrawerHeader className="shrink-0 text-left">
            <DrawerTitle>编辑流程 · {blueprint.label}</DrawerTitle>
            <DrawerDescription>
              左侧节点池点击加环节 · 从节点右侧连接点拖到下个节点左侧连线 · 选中节点可挂闸门或删除。
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 px-4 pb-2">
            <FlowEditor
              key={bodyKey}
              kind={blueprint.kind}
              value={blueprint.flow}
              onChange={setDraft}
            />
          </div>
          <DrawerFooter className="shrink-0 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存流程'}
            </Button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * 内联流程编辑器 —— 详情页「执行流程」区直接编辑，支持「全屏编辑」。
 * - 默认嵌在卡片里（固定高度），右上角「全屏」按钮放大到整屏覆盖层。
 * - 全屏覆盖层顶部有「退出全屏」按钮，并支持 Esc 退出、自动锁背景滚动。
 * - 画布 key 随全屏态切换 → 重挂时 react-flow 自动 fitView 适配新尺寸；value 用本地 draft
 *   （onChange 实时同步），故切换全屏不丢未保存改动；改动经防抖 700ms 自动写回 mock + 失效查询。
 */
export function InlineFlowEditor({ blueprint }: { blueprint: Blueprint }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<FlowGraph>(blueprint.flow);
  const [fullscreen, setFullscreen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (flow: FlowGraph) => {
      setDraft(flow);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void mockApi
          .updateBlueprint(blueprint.id, { flow })
          .then(() => qc.invalidateQueries({ queryKey: KEYS.blueprints }));
      }, 700);
    },
    [blueprint.id, qc],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

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

  // key 随全屏态变 → 切换时重挂 + fitView 适配新尺寸；value=draft 故不丢改动。
  const canvas = (
    <FlowEditor
      key={fullscreen ? 'fullscreen' : 'inline'}
      kind={blueprint.kind}
      value={draft}
      onChange={handleChange}
    />
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">流程编辑 ·</span>
            <span className="truncate font-medium">{blueprint.label}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setFullscreen(false)}>
            <Minimize2 className="size-4" />
            退出全屏
            <kbd className="ml-1 rounded border bg-muted px-1 text-[10px] text-muted-foreground">
              Esc
            </kbd>
          </Button>
        </div>
        <div className="min-h-0 flex-1">{canvas}</div>
      </div>
    );
  }

  return (
    <div className="relative h-[440px] overflow-hidden rounded-lg border bg-muted/10">
      {canvas}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setFullscreen(true)}
        aria-label="全屏编辑流程"
        title="全屏编辑"
        className="absolute right-2 top-2 z-20 size-8 bg-background/80 backdrop-blur"
      >
        <Maximize2 className="size-4" />
      </Button>
    </div>
  );
}
