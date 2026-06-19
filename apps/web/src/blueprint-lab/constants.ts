/**
 * 图纸实验室（原型）展示常量：标签、图标、各 kind 的环节模板、参数默认值。
 * 纯数据（含 lucide 组件引用），无 JSX。
 */
import {
  CalendarClock,
  Download,
  type LucideIcon,
  MessagesSquare,
  Newspaper,
  Play,
  RefreshCw,
  Repeat,
  Rss,
  Zap,
} from 'lucide-react';
import type {
  BlueprintKind,
  CollectParams,
  FlowGraph,
  ProcessStatus,
  RecheckParams,
  RunStatus,
  RunTrigger,
  SourceKind,
  TaskKind,
  TaskStatus,
  TriggerKind,
} from './types';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** 图纸类型元信息。 */
export const KIND_META: Record<BlueprintKind, { label: string; icon: LucideIcon; blurb: string }> =
  {
    collect: { label: '采集', icon: Download, blurb: '只抓新帖' },
    recheck: { label: '复查', icon: RefreshCw, blurb: '只查旧帖 · 探变化' },
  };

/**
 * 数据源元信息。channelLabel = 频道输入左侧的复合标题（按源更精确：版块/列表/订阅）；
 * defaultChannels = 「填入推荐预设」按钮写入的默认值。
 */
export const SOURCE_META: Record<
  SourceKind,
  {
    label: string;
    icon: LucideIcon;
    channelLabel: string;
    placeholder: string;
    defaultChannels: string[];
  }
> = {
  reddit: {
    label: 'Reddit',
    icon: MessagesSquare,
    channelLabel: '版块',
    placeholder: '请输入版块，逗号分隔',
    defaultChannels: ['r/SaaS', 'r/startups', 'r/Entrepreneur'],
  },
  hackernews: {
    label: 'Hacker News',
    icon: Newspaper,
    channelLabel: '列表',
    placeholder: '请输入列表，逗号分隔',
    defaultChannels: ['front', 'new'],
  },
  rss: {
    label: 'RSS',
    icon: Rss,
    channelLabel: '订阅',
    placeholder: '请输入订阅源，逗号分隔',
    defaultChannels: ['TechCrunch', 'Hacker Newsletter'],
  },
};

/** 触发方式元信息。 */
export const TRIGGER_META: Record<TriggerKind, { label: string; icon: LucideIcon; hint: string }> =
  {
    once: { label: '单次', icon: Play, hint: '手动触发一次，不重复' },
    interval: {
      label: '间隔',
      icon: Repeat,
      hint: '上一轮跑完冷却后再下一轮 · 不堆积、随吞吐自适应',
    },
    cron: { label: '定时', icon: CalendarClock, hint: '到墙钟点位触发（有界采集适用）' },
  };

/** 进程状态元信息。 */
export const PROCESS_STATUS_META: Record<ProcessStatus, { label: string; variant: BadgeVariant }> =
  {
    active: { label: '调度中', variant: 'default' },
    paused: { label: '已暂停', variant: 'outline' },
    completed: { label: '已完成', variant: 'secondary' },
  };

/** 运行状态元信息。 */
export const RUN_STATUS_META: Record<RunStatus, { label: string; variant: BadgeVariant }> = {
  running: { label: '运行中', variant: 'default' },
  completed: { label: '完成', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '已取消', variant: 'outline' },
  paused: { label: '暂停', variant: 'outline' },
};

/** 运行触发来源元信息（运行记录列表「触发」列用）。 */
export const RUN_TRIGGER_META: Record<RunTrigger, { label: string; icon: LucideIcon }> = {
  manual: { label: '手动', icon: Zap },
  interval: { label: '间隔', icon: Repeat },
  cron: { label: '定时', icon: CalendarClock },
};

/** 环节类型（连线编辑器「节点池」的一项）。 */
export interface StageType {
  /** 类型标识，全局唯一，= 后端 task_stages.name（执行内核据此跑环节）。 */
  name: string;
  /** 显示名。 */
  label: string;
  /** 适用图纸种类（决定出现在哪个 kind 的节点池）。 */
  kinds: BlueprintKind[];
  /** 派生环节（如事件派生的分析），视觉上虚线弱化。 */
  derived?: boolean;
  /** 一句话说明（节点池里悬浮提示）。 */
  desc: string;
}

/**
 * 可用环节类型注册表 —— 连线编辑器「节点池」的数据源。
 * 用户从此池往画布加节点；`name` 必须与后端 task_stages 模板一致（执行内核认识的环节才能跑）。
 * persist / analyze 跨 kind 通用；probe/detect/recrawl 仅复查；fetch_* / dedup 仅采集。
 * 与 docs/blueprint-lifecycle-design.md §3 对齐；analyze 由 persist 成功事件派生，故标 derived。
 */
export const STAGE_TYPES: StageType[] = [
  {
    name: 'fetch_listing',
    label: '采集帖子列表',
    kinds: ['collect'],
    desc: '按来源翻页拉取帖子列表',
  },
  {
    name: 'dedup',
    label: '过滤已知帖子',
    kinds: ['collect'],
    desc: '反连接已入库 / 在途帖，只留新帖',
  },
  { name: 'fetch_detail', label: '采集帖子详情', kinds: ['collect'], desc: '抓取单帖正文与元数据' },
  { name: 'fetch_comments', label: '采集帖子评论', kinds: ['collect'], desc: '翻页抓取评论树' },
  {
    name: 'probe',
    label: '探测评论计数',
    kinds: ['recheck'],
    desc: '轻请求取现网评论数，与基线比对',
  },
  {
    name: 'detect',
    label: '检测评论变化',
    kinds: ['recheck'],
    desc: '判定是否有新评论、决定是否重采',
  },
  { name: 'recrawl', label: '重新采集评论', kinds: ['recheck'], desc: '有变化则全量重抓评论' },
  {
    name: 'persist',
    label: '写入数据库',
    kinds: ['collect', 'recheck'],
    desc: '落库 + 刷新记账 / 基线',
  },
  {
    name: 'analyze',
    label: '派生分析任务',
    kinds: ['collect', 'recheck'],
    derived: true,
    desc: '入库成功后派生 AI 分析任务',
  },
];

/** 按种类取可用环节类型（节点池按 kind 过滤）。 */
export function stageTypesForKind(kind: BlueprintKind): StageType[] {
  return STAGE_TYPES.filter((t) => t.kinds.includes(kind));
}

/** 按 name 查环节类型（渲染节点时取 label / derived）。 */
export function stageType(name: string): StageType | undefined {
  return STAGE_TYPES.find((t) => t.name === name);
}

/** 初始流程的节点横向间距。 */
const FLOW_GAP_X = 220;

/** 把一串环节 name 连成一条线性 DAG —— 新建图纸的初始脚手架，进编辑器后可自由改。 */
function linearFlow(names: string[]): FlowGraph {
  return {
    nodes: names.map((type, i) => ({
      id: `n_${type}`,
      type,
      position: { x: i * FLOW_GAP_X, y: 0 },
    })),
    edges: names.slice(1).map((type, i) => ({
      id: `e_${names[i]}_${type}`,
      source: `n_${names[i]}`,
      target: `n_${type}`,
    })),
  };
}

/** 各 kind 新建图纸时的初始流程（默认线性链；用户进编辑器后自由编排成任意 DAG）。 */
export const DEFAULT_FLOW: Record<BlueprintKind, FlowGraph> = {
  collect: linearFlow([
    'fetch_listing',
    'dedup',
    'fetch_detail',
    'fetch_comments',
    'persist',
    'analyze',
  ]),
  recheck: linearFlow(['probe', 'detect', 'recrawl', 'persist', 'analyze']),
};

/** 采集参数默认值（新建图纸时的种子）。 */
export const DEFAULT_COLLECT_PARAMS: CollectParams = {
  limit: 100,
  stopAfterKnown: 5,
  commentBudget: 200,
};

/** 复查参数默认值。 */
export const DEFAULT_RECHECK_PARAMS: RecheckParams = {
  batchSize: 20,
  batchIntervalSec: 60,
  backoffCap: 16,
};

/** 参数说明（图纸表单里点 ⓘ 气泡展开）。 */
export const PARAM_HELP: Record<BlueprintKind, { label: string; desc: string }[]> = {
  collect: [
    {
      label: '翻页上限',
      desc: '沿 new 时间线单源单轮最多翻取的帖数（封顶兜底，正常先被「连续命中即停」收口）。',
    },
    {
      label: '连续命中即停',
      desc: '翻页时连续遇到 N 条已入库的帖即停止翻页 —— 增量收口、省请求。',
    },
    { label: '评论预算', desc: '每帖最多抓取的评论条数（含翻页）。' },
  ],
  recheck: [
    { label: '每批帖数', desc: '一轮 sweep 内每批纳入复查的帖子数。' },
    { label: '批间冷却', desc: '每批跑完后等待的秒数，用来平滑出站请求速率。' },
    {
      label: '退避封顶',
      desc: '连续未变的帖，复查间隔按 1 · 2 · 4 · … 倍递增，最多跳过这么多轮 sweep。',
    },
  ],
};

// ─── 运行下钻：任务 / 环节元信息（运行详情星图 + 侧栏用） ──────────────────────────────

/** 任务种类元信息：中文名 + 单字标（星图节点用）。 */
export const TASK_KIND_META: Record<TaskKind, { label: string; tag: string }> = {
  discover: { label: '发现', tag: '发' },
  collect: { label: '采集', tag: '采' },
  recheck: { label: '复查', tag: '查' },
  analyze: { label: '分析', tag: '析' },
  translate: { label: '翻译', tag: '译' },
};

/** 任务状态元信息（侧栏徽标）。 */
export const TASK_STATUS_META: Record<TaskStatus, { label: string; variant: BadgeVariant }> = {
  queued: { label: '排队', variant: 'outline' },
  running: { label: '运行中', variant: 'default' },
  paused: { label: '暂停', variant: 'outline' },
  succeeded: { label: '成功', variant: 'secondary' },
  skipped: { label: '略过', variant: 'outline' },
  failed: { label: '失败', variant: 'destructive' },
  canceled: { label: '已取消', variant: 'outline' },
};

/**
 * 各任务种类的环节模板（run/task 级，区别于图纸级 DEFAULT_FLOW）。
 * 与 docs/blueprint-lifecycle-design.md §三的任务树对齐；gate 标记默认挂闸门处（如分析的 ai_call）。
 */
export const TASK_STAGE_TEMPLATE: Record<TaskKind, { name: string; gate?: boolean }[]> = {
  discover: [{ name: 'fetch_listing' }, { name: 'dedup' }, { name: 'spawn' }],
  collect: [{ name: 'fetch_detail' }, { name: 'fetch_comments' }, { name: 'persist' }],
  recheck: [{ name: 'probe' }, { name: 'detect' }, { name: 'recrawl' }, { name: 'persist' }],
  analyze: [
    { name: 'resolve' },
    { name: 'fetch' },
    { name: 'context' },
    { name: 'ai_call', gate: true },
    { name: 'normalize' },
    { name: 'persist' },
  ],
  translate: [{ name: 'resolve' }, { name: 'translate_call', gate: true }, { name: 'persist' }],
};

/** 各环节的产物摘要样例（检查点 jsonb 的展示侧；原型用，后端落地后由真实产物替换）。 */
export const STAGE_OUTPUT: Record<string, string> = {
  fetch_listing: '翻 4 页 · 候选 120 帖 · 4 请求入闸',
  dedup: '反连接：滤 108 已知 · 余 12 新帖',
  spawn: '派生 12 个采集子任务',
  fetch_detail: '标题 / 正文 / 分数 / 作者',
  fetch_comments: '抓 47 条评论 · 翻 3 页 · 逐页入闸',
  probe: '现网评论数 51 vs 基线 47',
  detect: '有新评论 → 触发重采',
  recrawl: '全量重抓评论 · 翻 4 页',
  persist: '入库 · 刷新 num_comments 基线',
  resolve: '命中 active 模型 · claude-opus',
  fetch: '读帖 + 评论快照',
  context: '拼装上下文 · 3.2k tokens',
  ai_call: '完整 prompt + AI 原始响应 · in 3.2k / out 480',
  normalize: '解析洞察 · 5 条',
  translate_call: '译文 · claude_cli 零边际',
};
