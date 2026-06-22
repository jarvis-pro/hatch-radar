import type {
  BlueprintRow,
  ProcessRow,
  RunRow,
  TaskStageRow,
} from '@/lib/db';
import {
  STAGE_TEMPLATES,
  type BlueprintDTO,
  type BlueprintKind,
  type ProcessDTO,
  type RadarCommentDTO,
  type RadarLaneId,
  type RunDTO,
  type StageDTO,
  type TaskKind,
  type TriggerConfig,
} from '@hatch-radar/shared';

/**
 * 雷达指挥室纯映射 / 工具函数（无副作用、无依赖）。
 *
 * 从原 RadarService 抽出，供拆分后的 {@link BlueprintService} / {@link ProcessService} / RadarService
 * 三处共用：PG 行 ⇄ 前端 DTO 形状转换、触发配置编解码、环节 lane 推导与产物摘要、评论树构建。
 */

export function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function toBlueprintDTO(b: BlueprintRow): BlueprintDTO {
  return {
    id: b.id,
    kind: b.kind as BlueprintKind,
    label: b.label,
    note: b.note,
    sources: Array.isArray(b.sources) ? (b.sources as unknown as BlueprintDTO['sources']) : [],
    params: asRecord(b.params),
    gates: asStrArr(b.gates),
    enabledStages: asStrArr(b.enabled_stages),
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

/** ProcessRow.trigger_kind + trigger_config → 前端 TriggerConfig 联合。 */
export function triggerOf(p: ProcessRow): TriggerConfig {
  const cfg = asRecord(p.trigger_config);
  if (p.trigger_kind === 'interval') {
    return { kind: 'interval', everySec: typeof cfg.everySec === 'number' ? cfg.everySec : 0 };
  }
  if (p.trigger_kind === 'cron') {
    return { kind: 'cron', expr: typeof cfg.expr === 'string' ? cfg.expr : '' };
  }
  return { kind: 'once' };
}

/** 前端 TriggerConfig → { triggerKind, triggerConfig } 入库形状。 */
export function triggerToRepo(t: TriggerConfig): { triggerKind: string; triggerConfig: unknown } {
  if (t.kind === 'interval')
    return { triggerKind: 'interval', triggerConfig: { everySec: t.everySec } };
  if (t.kind === 'cron') return { triggerKind: 'cron', triggerConfig: { expr: t.expr } };
  return { triggerKind: 'once', triggerConfig: null };
}

export function toProcessDTO(p: ProcessRow, kind: BlueprintKind): ProcessDTO {
  return {
    id: p.id,
    blueprintId: p.blueprint_id,
    blueprintKind: kind,
    label: p.label,
    trigger: triggerOf(p),
    status: p.status === 'paused' ? 'paused' : 'active',
    sweepSeq: p.sweep_seq,
    runsTotal: p.runs_total,
    lastRunAt: p.last_run_at,
    nextRunAt: p.next_run_at,
  };
}

export function toRunDTO(
  r: RunRow,
  blueprintLabel: string | null,
  processLabel: string | null,
): RunDTO {
  return {
    id: r.id,
    processId: r.process_id,
    processLabel,
    blueprintId: r.blueprint_id,
    blueprintLabel,
    kind: r.kind,
    status: r.status,
    triggerSource: r.trigger_source,
    sweepSeq: r.sweep_seq,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    tasksTotal: r.tasks_total,
    tasksDone: r.tasks_done,
    tasksSkipped: r.tasks_skipped,
    tasksFailed: r.tasks_failed,
  };
}

/** 环节 lane：fetch:'source'→帖来源、fetch:'ai'→ai、本地环节→null（按 STAGE_TEMPLATES 推导）。 */
export function stageLane(kind: TaskKind, name: string, source: string | null): RadarLaneId | null {
  const def = STAGE_TEMPLATES[kind]?.find((s) => s.name === name);
  if (def?.fetch === 'ai') return 'ai';
  if (def?.fetch === 'source') {
    if (source === 'reddit' || source === 'hackernews' || source === 'rss') return source;
    return null;
  }
  return null;
}

/** 环节产物 jsonb → 人话摘要（展示用；不可解析则 null）。 */
export function summarizeStage(name: string, output: unknown): string | null {
  const o = asRecord(output);
  const num = (k: string): number => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  switch (name) {
    case 'fetch_listing':
      return `新增 ${num('added')} · 更新 ${num('updated')}`;
    case 'dedup':
      return `候选 ${Array.isArray(o.toSpawn) ? (o.toSpawn as unknown[]).length : 0}`;
    case 'spawn':
      return `派生采集 ${num('collectSpawned')}`;
    case 'fetch_comments':
    case 'recrawl':
      return `评论 ${num('commentCount')}`;
    case 'persist':
      if ('changed' in o) return o.changed ? '有变化 → 重新分析' : '无变化 · 退避';
      if ('analyzeSpawned' in o) return o.analyzeSpawned ? '落库 · 派生分析' : '落库';
      if ('saved' in o) return o.saved ? '洞察已落库' : '无信号 · 未落库';
      return '落库';
    case 'ai_call':
      return 'AI 响应已落检查点';
    case 'translate':
      return `翻译 ${num('translated')} 段`;
    default:
      return null;
  }
}

export function toStageDTO(s: TaskStageRow, kind: TaskKind, source: string | null): StageDTO {
  return {
    seq: s.seq,
    name: s.name,
    status: s.status as StageDTO['status'],
    gate: s.gate,
    lane: stageLane(kind, s.name, source),
    output: summarizeStage(s.name, s.output),
    error: s.error,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
  };
}

export function firstPainPoint(painPoints: unknown, fallback: string): string {
  const first = (Array.isArray(painPoints) ? painPoints[0] : null) as {
    description?: string;
    title?: string;
  } | null;
  return first?.description ?? first?.title ?? fallback;
}

/** 评论平铺列表 → 楼层树（按 parent_id）。 */
export function buildCommentTree(
  rows: {
    id: string;
    parent_id: string | null;
    author: string | null;
    body: string;
    score: number;
    depth: number;
    created_utc: bigint;
    body_hash: string | null;
  }[],
): RadarCommentDTO[] {
  const byId = new Map<string, RadarCommentDTO>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      author: r.author,
      score: r.score,
      depth: r.depth,
      body: r.body,
      bodyHash: r.body_hash,
      createdUtc: Number(r.created_utc),
      children: [],
    });
  }
  const roots: RadarCommentDTO[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
