/**
 * 雷达指挥室（radar-lab）—— 环节模板 / 耗时模型 / 视觉词表。
 *
 * 流程**收敛到可执行**：每种 task kind 一条固定线性环节序列（不做自由 DAG）。
 * fetch 环节标 `fetch:'source'|'ai'`，engine 据帖来源解析具体 lane 并落到 Stage.lane。
 */
import {
  Clock,
  Download,
  Inbox,
  Lightbulb,
  MessageSquare,
  Newspaper,
  Play,
  RefreshCw,
  Repeat,
  Rss,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type {
  BlueprintKind,
  CollectParams,
  Intensity,
  LaneId,
  RecheckParams,
  RunStatus,
  SourceKind,
  StageStatus,
  TaskKind,
  TaskStatus,
  TriggerKind,
} from './types';

/** 环节模板项：名称 + 耗时预算（sim ms）+ 是否 fetch（经请求闸的 lane）。 */
export interface StageDef {
  name: string;
  costMs: number;
  fetch?: 'source' | 'ai';
}

/** 每种 task kind 的固定可执行环节序列。 */
export const STAGE_TEMPLATES: Record<TaskKind, StageDef[]> = {
  discover: [
    { name: 'fetch_listing', costMs: 1000, fetch: 'source' },
    { name: 'dedup', costMs: 400 },
    { name: 'spawn', costMs: 300 },
  ],
  collect: [
    { name: 'fetch_detail', costMs: 800, fetch: 'source' },
    { name: 'fetch_comments', costMs: 1500, fetch: 'source' },
    { name: 'persist', costMs: 400 },
  ],
  recheck: [
    { name: 'probe', costMs: 600, fetch: 'source' },
    { name: 'detect', costMs: 200 },
    { name: 'recrawl', costMs: 1500, fetch: 'source' },
    { name: 'persist', costMs: 400 },
  ],
  analyze: [
    { name: 'resolve', costMs: 200 },
    { name: 'fetch', costMs: 300 },
    { name: 'context', costMs: 600 },
    { name: 'ai_call', costMs: 6000, fetch: 'ai' },
    { name: 'normalize', costMs: 500 },
    { name: 'persist', costMs: 400 },
  ],
};

export const STAGE_META: Record<string, { label: string }> = {
  fetch_listing: { label: '抓列表' },
  dedup: { label: '去重' },
  spawn: { label: '派生采集' },
  fetch_detail: { label: '抓详情' },
  fetch_comments: { label: '抓评论' },
  persist: { label: '落库' },
  probe: { label: '探测' },
  detect: { label: '比对变化' },
  recrawl: { label: '重抓评论' },
  resolve: { label: '取帖' },
  fetch: { label: '取上下文' },
  context: { label: '组装上下文' },
  ai_call: { label: 'AI 分析' },
  normalize: { label: '归一化' },
};

export function stageLabel(name: string): string {
  return STAGE_META[name]?.label ?? name;
}

export const KIND_META: Record<BlueprintKind, { label: string; icon: LucideIcon; blurb: string }> = {
  collect: { label: '采集', icon: Download, blurb: '只抓新帖' },
  recheck: { label: '复查', icon: RefreshCw, blurb: '只查旧帖、探变化' },
};

export const TASK_KIND_META: Record<TaskKind, { label: string; icon: LucideIcon; color: string }> =
  {
    discover: { label: '发现', icon: Search, color: 'text-muted-foreground' },
    collect: { label: '采集', icon: Inbox, color: 'text-primary' },
    recheck: { label: '复查', icon: RefreshCw, color: 'text-signal' },
    analyze: { label: '分析', icon: Lightbulb, color: 'text-intensity-high' },
  };

export const SOURCE_META: Record<SourceKind, { label: string; icon: LucideIcon; lane: LaneId }> = {
  reddit: { label: 'Reddit', icon: MessageSquare, lane: 'reddit' },
  hackernews: { label: 'Hacker News', icon: Newspaper, lane: 'hackernews' },
  rss: { label: 'RSS', icon: Rss, lane: 'rss' },
};

export function sourceToLane(s: SourceKind): LaneId {
  return SOURCE_META[s].lane;
}

export const LANE_META: Record<LaneId, { label: string; icon: LucideIcon; color: string; bar: string }> =
  {
    reddit: { label: 'Reddit', icon: MessageSquare, color: 'text-orange-500', bar: 'bg-orange-500' },
    hackernews: { label: 'Hacker News', icon: Newspaper, color: 'text-sky-500', bar: 'bg-sky-500' },
    rss: { label: 'RSS', icon: Rss, color: 'text-violet-500', bar: 'bg-violet-500' },
    ai: { label: 'AI', icon: Sparkles, color: 'text-primary', bar: 'bg-primary' },
  };

export const TRIGGER_META: Record<TriggerKind, { label: string; icon: LucideIcon }> = {
  once: { label: '单次', icon: Play },
  interval: { label: '间隔', icon: Repeat },
  cron: { label: '定时', icon: Clock },
};

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

export const TASK_STATUS_META: Record<TaskStatus, { label: string; dot: string; variant: BadgeVariant }> =
  {
    queued: { label: '排队', dot: 'bg-muted-foreground/30', variant: 'outline' },
    running: { label: '运行中', dot: 'bg-primary', variant: 'default' },
    paused: { label: '暂停', dot: 'bg-intensity-medium', variant: 'secondary' },
    succeeded: { label: '完成', dot: 'bg-muted-foreground', variant: 'outline' },
    skipped: { label: '略过', dot: 'bg-muted-foreground/30', variant: 'outline' },
    failed: { label: '失败', dot: 'bg-intensity-high', variant: 'destructive' },
    canceled: { label: '取消', dot: 'bg-muted-foreground/30', variant: 'outline' },
  };

export const STAGE_STATUS_META: Record<StageStatus, { label: string; dot: string }> = {
  pending: { label: '待执行', dot: 'bg-muted-foreground/25' },
  running: { label: '运行中', dot: 'bg-primary' },
  waiting: { label: '等放行', dot: 'bg-intensity-medium' },
  done: { label: '完成', dot: 'bg-muted-foreground' },
  skipped: { label: '略过', dot: 'bg-muted-foreground/30' },
  failed: { label: '失败', dot: 'bg-intensity-high' },
};

export const RUN_STATUS_META: Record<RunStatus, { label: string; variant: BadgeVariant }> = {
  running: { label: '运行中', variant: 'default' },
  completed: { label: '完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '取消', variant: 'outline' },
};

export const INTENSITY_META: Record<Intensity, { label: string; bar: string; text: string }> = {
  high: { label: '强', bar: 'bg-intensity-high', text: 'text-intensity-high' },
  medium: { label: '中', bar: 'bg-intensity-medium', text: 'text-intensity-medium' },
  low: { label: '弱', bar: 'bg-intensity-low', text: 'text-intensity-low' },
};

/** lane 默认配置（rate/burst）。 */
export const DEFAULT_LANES: { id: LaneId; label: string; ratePerMin: number; burst: number }[] = [
  { id: 'reddit', label: 'Reddit', ratePerMin: 60, burst: 8 },
  { id: 'hackernews', label: 'Hacker News', ratePerMin: 60, burst: 8 },
  { id: 'rss', label: 'RSS', ratePerMin: 90, burst: 10 },
  { id: 'ai', label: 'AI', ratePerMin: 12, burst: 3 },
];

export const DEFAULT_COLLECT_PARAMS: CollectParams = {
  limit: 100,
  stopAfterKnown: 5,
  commentBudget: 200,
};
export const DEFAULT_RECHECK_PARAMS: RecheckParams = {
  batchSize: 20,
  batchIntervalSec: 90,
  backoffCap: 16,
};

/** 模拟时钟倍速档位。 */
export const SPEED_OPTIONS = [1, 4, 16] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];
/** 时钟基准 tick（真实 ms）。sim 推进 = TICK_MS × speed。 */
export const TICK_MS = 250;
