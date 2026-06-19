/**
 * 图纸实验室（原型）内存 mock 存储 —— 模拟后端 `/api/blueprints|processes|runs`。
 *
 * 设计意图：所有读写都走这里的 async 函数（模拟网络延迟），页面用 react-query 消费。
 * 后端落地时，**只需把页面里 queryFn / mutationFn 从 `mockApi.xxx()` 换成 `api.get('/...')`**，
 * 组件与 [types.ts](./types) 契约原样保留。状态为模块级单例，整页刷新即重置（原型够用）。
 */
import { PAGE_SIZE, type Paged } from '@hatch-radar/shared';
import { DEFAULT_FLOW, STAGE_OUTPUT, TASK_STAGE_TEMPLATE } from './constants';
import { POSTS } from './mock-corpus';
import type {
  Blueprint,
  BlueprintKind,
  MockPost,
  Process,
  Run,
  RunDetail,
  RunStats,
  RunStatus,
  RunTrigger,
  SourceSelection,
  Stage,
  StageStatus,
  Task,
  TaskKind,
  TaskStatus,
  TriggerConfig,
} from './types';

/** 模拟网络往返延迟。 */
function delay<T>(value: T, ms = 160): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}${(Date.now() % 100000).toString(36)}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** 间隔进程：从某基准推下次触发时刻。 */
function computeNextRun(trigger: TriggerConfig, from: number): number | null {
  if (trigger.kind === 'interval') return from + trigger.everySec * 1000;
  if (trigger.kind === 'cron') return from + HOUR; // 原型：cron 简化为约 1 小时后
  return null; // once：等手动触发
}

// ─── 种子数据 ────────────────────────────────────────────────────────────────

const now = Date.now();

const blueprints: Blueprint[] = [
  {
    id: 'bp_reddit_saas',
    kind: 'collect',
    label: 'Reddit · SaaS 选区采集',
    note: '主力采集线，覆盖核心创业/SaaS 版块',
    sources: [{ kind: 'reddit', channels: ['r/SaaS', 'r/startups', 'r/Entrepreneur'] }],
    params: { limit: 100, stopAfterKnown: 5, commentBudget: 200 },
    flow: DEFAULT_FLOW.collect,
    createdAt: now - 9 * 24 * HOUR,
    updatedAt: now - 2 * 24 * HOUR,
  },
  {
    id: 'bp_hn_only',
    kind: 'collect',
    label: '只抓 Hacker News',
    note: '单渠道图纸示例 —— 仅 HN，与 Reddit 互不干扰',
    sources: [{ kind: 'hackernews', channels: ['front', 'new'] }],
    params: { limit: 60, stopAfterKnown: 8, commentBudget: 150 },
    flow: DEFAULT_FLOW.collect,
    createdAt: now - 6 * 24 * HOUR,
    updatedAt: now - 6 * 24 * HOUR,
  },
  {
    id: 'bp_recheck_hot',
    kind: 'recheck',
    label: '热帖复查',
    note: '只查已入库旧帖、探评论变化；指数退避封顶',
    sources: [{ kind: 'reddit', channels: ['r/SaaS', 'r/startups'] }],
    params: { batchSize: 20, batchIntervalSec: 90, backoffCap: 16 },
    flow: DEFAULT_FLOW.recheck,
    createdAt: now - 5 * 24 * HOUR,
    updatedAt: now - 1 * 24 * HOUR,
  },
  {
    id: 'bp_rss_news',
    kind: 'collect',
    label: 'RSS · 行业资讯',
    note: '尚未派生进程 —— 可在右侧「新建进程」给它挂一个节奏',
    sources: [{ kind: 'rss', channels: ['TechCrunch', 'Hacker Newsletter'] }],
    params: { limit: 50, stopAfterKnown: 3, commentBudget: 0 },
    flow: DEFAULT_FLOW.collect,
    createdAt: now - 3 * 24 * HOUR,
    updatedAt: now - 3 * 24 * HOUR,
  },
];

const processes: Process[] = [
  {
    id: 'pr_saas_30m',
    blueprintId: 'bp_reddit_saas',
    label: 'SaaS 采集 · 每 30 分',
    trigger: { kind: 'interval', everySec: 30 * 60 },
    status: 'active',
    createdAt: now - 9 * 24 * HOUR,
    lastRunAt: now - 12 * MIN,
    nextRunAt: now + 18 * MIN,
    sweepSeq: 0,
    runsTotal: 412,
  },
  {
    id: 'pr_saas_launch',
    blueprintId: 'bp_reddit_saas',
    label: 'SaaS 采集 · 发布日加密（每 5 分）',
    trigger: { kind: 'interval', everySec: 5 * 60 },
    status: 'paused',
    createdAt: now - 2 * 24 * HOUR,
    lastRunAt: now - 26 * HOUR,
    nextRunAt: null,
    sweepSeq: 0,
    runsTotal: 38,
  },
  {
    id: 'pr_hn_15m',
    blueprintId: 'bp_hn_only',
    label: 'HN 采集 · 每 15 分',
    trigger: { kind: 'interval', everySec: 15 * 60 },
    status: 'active',
    createdAt: now - 6 * 24 * HOUR,
    lastRunAt: now - 4 * MIN,
    nextRunAt: now + 11 * MIN,
    sweepSeq: 0,
    runsTotal: 561,
  },
  {
    id: 'pr_recheck_1h',
    blueprintId: 'bp_recheck_hot',
    label: '热帖复查 · 每小时一轮',
    trigger: { kind: 'interval', everySec: HOUR / 1000 },
    status: 'active',
    createdAt: now - 5 * 24 * HOUR,
    lastRunAt: now - 38 * MIN,
    nextRunAt: now + 22 * MIN,
    sweepSeq: 73,
    runsTotal: 73,
  },
];

/** 失败运行的示例原因（轮取），覆盖采集/复查/分析各环节的典型故障，让「失败原因」列有真实质感。 */
const RUN_ERRORS = [
  'Reddit 403 —— 该版块需登录或已转私有',
  'AI 调用超时：ai_call 环节等待 120s 无响应',
  '出站请求被限速：reddit lane 连续 429，本轮放弃',
  'fetch_comments 翻页中断：上游返回畸形 JSON',
  'persist 写库失败：唯一约束冲突（uniq_task_stages_task_seq）',
];

/**
 * 给一个进程造 count 条历史运行，时间戳沿节奏往前铺（i=0 最新）。
 * 状态/触发来源/失败原因按确定式规则掺入变化，使列表、指标条、失败原因列都有真实分布。
 */
function seedRuns(p: Process, count: number): Run[] {
  const bp = blueprints.find((b) => b.id === p.blueprintId)!;
  const stepMs = p.trigger.kind === 'interval' ? p.trigger.everySec * 1000 : HOUR;
  // 进程节奏 → 默认触发来源（once 进程只能手动触发）。
  const scheduled: RunTrigger = p.trigger.kind === 'once' ? 'manual' : p.trigger.kind;
  const out: Run[] = [];
  for (let i = 0; i < count; i++) {
    const started = (p.lastRunAt ?? now) - i * stepMs;
    const isLiveHead = i === 0 && p.status === 'active';

    let status: RunStatus = 'completed';
    if (isLiveHead) status = 'running';
    else if (i % 17 === 5) status = 'failed';
    else if (i % 41 === 13) status = 'canceled';

    const total = bp.kind === 'recheck' ? 20 : 12 + ((i * 7) % 30);
    const skipped = bp.kind === 'recheck' ? 12 + ((i * 3) % 6) : 0;
    const failed = status === 'failed' ? 1 + (i % 3) : 0;
    const done =
      status === 'running'
        ? Math.floor(total * 0.4)
        : status === 'canceled'
          ? Math.max(0, Math.floor(total * 0.6) - skipped)
          : total - skipped - failed;
    // 大多按节奏触发；每 ~13 条掺一次人工「立即触发」（live head 恒为节奏触发）。
    const triggerSource: RunTrigger = !isLiveHead && i % 13 === 9 ? 'manual' : scheduled;

    out.push({
      id: nextId('run'),
      processId: p.id,
      blueprintId: p.blueprintId,
      kind: bp.kind,
      status,
      triggerSource,
      error: status === 'failed' ? RUN_ERRORS[i % RUN_ERRORS.length]! : null,
      sweepSeq: bp.kind === 'recheck' ? p.sweepSeq - i : null,
      tasksTotal: total,
      tasksDone: Math.max(0, done),
      tasksSkipped: skipped,
      tasksFailed: failed,
      startedAt: started,
      finishedAt: status === 'running' ? null : started + 3 * MIN,
    });
  }
  return out;
}

// 按各进程 runsTotal 全量造历史运行 —— 让分页真实可演（HN 进程 = 561 条 ≈ 29 页）。
const runs: Run[] = processes.flatMap((p) => seedRuns(p, p.runsTotal));

// ─── 运行详情：任务树 + 环节（按需从 run 派生，不预生成，避免为数百条 run 造满树） ─────────

/** 稳定字符串哈希（FNV-1a），给同一 run 派生可复现的帖子 id / 布局种子。 */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 截断长文本。 */
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * 环节产物：有帖子的环节按该帖真实数据派生（标题/评论数/深度/翻页/token…），
 * discover 等无帖环节回退到 STAGE_OUTPUT 的通用样例。
 */
function stageOutput(name: string, post: MockPost | null): string | null {
  if (!post) return STAGE_OUTPUT[name] ?? null;
  const pages = Math.max(1, Math.ceil(post.numComments / 80));
  const ctxTok = 600 + Math.round(post.body.length * 1.2) + post.numComments * 18;
  const outTok = 180 + (post.numComments % 7) * 60;
  const insights = 1 + ((post.score + post.numComments) % 5);
  const delta = post.numComments === 0 ? 0 : hashStr(post.id) % 6;
  switch (name) {
    case 'fetch_detail':
      return `「${truncate(post.title, 36)}」· ${post.score}↑ · u/${post.author}`;
    case 'fetch_comments':
      return post.numComments > 0
        ? `抓 ${post.numComments} 评论 · 最深 ${post.commentDepth} 层 · 翻 ${pages} 页`
        : '该帖暂无评论';
    case 'persist':
      return `入库 1 帖 · num_comments=${post.numComments} 基线`;
    case 'probe':
      return `现网 ${post.numComments + delta} 评论 vs 基线 ${post.numComments}`;
    case 'detect':
      return delta > 0 ? `+${delta} 新评论 → 触发重采` : '无变化 → 退避跳过';
    case 'recrawl':
      return `全量重抓 ${post.numComments + delta} 评论 · 最深 ${post.commentDepth} 层`;
    case 'resolve':
      return '命中 active 模型 · claude-opus';
    case 'fetch':
      return `读帖 + ${post.numComments} 评论快照`;
    case 'context':
      return `拼装上下文 · ${ctxTok.toLocaleString()} tokens`;
    case 'ai_call':
      return `prompt ${ctxTok.toLocaleString()} tok + AI 原始响应 · out ${outTok} tok`;
    case 'normalize':
      return `解析洞察 · ${insights} 条`;
    default:
      return STAGE_OUTPUT[name] ?? null;
  }
}

/** 由任务状态推每个环节的状态（done/running/paused/failed/pending/skipped）。 */
function stageStatusFor(taskStatus: TaskStatus, tpl: { gate?: boolean }[], i: number): StageStatus {
  const n = tpl.length;
  if (taskStatus === 'succeeded') return 'done';
  if (taskStatus === 'skipped') return 'skipped';
  if (taskStatus === 'queued') return 'pending';
  if (taskStatus === 'canceled') return i === 0 ? 'done' : 'skipped';
  const gateIdx = tpl.findIndex((s) => s.gate);
  if (taskStatus === 'paused') {
    const g = gateIdx >= 0 ? gateIdx : n - 1;
    return i < g ? 'done' : i === g ? 'paused' : 'pending';
  }
  if (taskStatus === 'failed') {
    const f = Math.min(n - 1, gateIdx >= 0 ? gateIdx : 1);
    return i < f ? 'done' : i === f ? 'failed' : 'pending';
  }
  if (taskStatus === 'running') {
    const r = Math.min(n - 1, 1);
    return i < r ? 'done' : i === r ? 'running' : 'pending';
  }
  return 'pending';
}

/** 按 kind 模板造一串环节（产物按所挂帖子真实派生 / 失败原因）。 */
function makeStages(kind: TaskKind, taskStatus: TaskStatus, post: MockPost | null): Stage[] {
  const tpl = TASK_STAGE_TEMPLATE[kind] ?? [];
  return tpl.map((s, i) => {
    const status = stageStatusFor(taskStatus, tpl, i);
    const produced = status === 'done' || status === 'running' || status === 'paused';
    return {
      seq: i,
      name: s.name,
      status,
      gate: !!s.gate,
      output: produced ? stageOutput(s.name, post) : null,
      error: status === 'failed' ? `${s.name} 环节失败（示例原因）` : null,
    };
  });
}

/**
 * 由一条 run 派生其任务树（确定式，可复现）。
 * collect：run → discover（根）→ collect[]（每帖）→ analyze[]（部分 persist 后派生）。
 * recheck：run → recheck[]（根，多数因退避 skipped）→ analyze[]（变化的少数）。
 * 计数大致贴合 run 的 tasksTotal/Done/Skipped/Failed；运行中/暂停态仅在 run 非终态时出现。
 */
function buildRunTasks(run: Run): Task[] {
  const tasks: Task[] = [];
  // 起点错开 + 顺序取 → 一条 run 内连续任务挂不同帖（≤语料数不重复），覆盖各内容形态。
  const seedBase = hashStr(run.id) % POSTS.length;
  const postFor = (i: number): MockPost => POSTS[(seedBase + i) % POSTS.length]!;
  const mk = (
    id: string,
    kind: TaskKind,
    status: TaskStatus,
    parentId: string | null,
    post: MockPost | null,
  ): string => {
    tasks.push({
      id,
      runId: run.id,
      kind,
      status,
      parentId,
      postId: post?.id ?? null,
      post,
      stages: makeStages(kind, status, post),
    });
    return id;
  };
  const allowRunning = run.status === 'running';
  const allowPaused = run.status === 'running' || run.status === 'paused';
  const total = Math.max(1, run.tasksTotal);

  if (run.kind === 'collect') {
    const disc = mk(`${run.id}_disc`, 'discover', 'succeeded', null, null);
    let failedLeft = run.tasksFailed;
    let runningSlot = allowRunning;
    let pausedSlot = allowPaused;
    let analyzeRunSlot = allowRunning;
    for (let i = 0; i < total; i++) {
      const post = postFor(i);
      let cs: TaskStatus = 'succeeded';
      if (failedLeft > 0) {
        cs = 'failed';
        failedLeft--;
      } else if (runningSlot && i === total - 1) {
        cs = 'running';
        runningSlot = false;
      }
      const cid = mk(`${run.id}_c${i}`, 'collect', cs, disc, post);
      if (cs === 'succeeded' && i % 2 === 0) {
        let as: TaskStatus = 'succeeded';
        if (pausedSlot) {
          as = 'paused';
          pausedSlot = false;
        } else if (analyzeRunSlot) {
          as = 'running';
          analyzeRunSlot = false;
        }
        mk(`${run.id}_a${i}`, 'analyze', as, cid, post);
      }
    }
  } else {
    let skipLeft = run.tasksSkipped;
    let failLeft = run.tasksFailed;
    let runningSlot = allowRunning;
    let pausedSlot = allowPaused;
    for (let i = 0; i < total; i++) {
      const post = postFor(i);
      let rs: TaskStatus = 'succeeded';
      if (skipLeft > 0) {
        rs = 'skipped';
        skipLeft--;
      } else if (failLeft > 0) {
        rs = 'failed';
        failLeft--;
      } else if (runningSlot && i === total - 1) {
        rs = 'running';
        runningSlot = false;
      }
      const rid = mk(`${run.id}_r${i}`, 'recheck', rs, null, post);
      if (rs === 'succeeded' && i % 3 === 0) {
        let as: TaskStatus = 'succeeded';
        if (pausedSlot) {
          as = 'paused';
          pausedSlot = false;
        }
        mk(`${run.id}_a${i}`, 'analyze', as, rid, post);
      }
    }
  }
  return tasks;
}

// ─── 读 ──────────────────────────────────────────────────────────────────────

export const mockApi = {
  listBlueprints: () => delay([...blueprints].sort((a, b) => b.updatedAt - a.updatedAt)),

  listProcesses: (blueprintId: string) =>
    delay(
      processes
        .filter((p) => p.blueprintId === blueprintId)
        .sort((a, b) => b.createdAt - a.createdAt),
    ),

  /** 全部进程（进程管理页用），按创建时间倒序。 */
  listAllProcesses: () => delay([...processes].sort((a, b) => b.createdAt - a.createdAt)),

  /** 取单个进程（运行记录页头用）。 */
  getProcess: (id: string) => delay(processes.find((p) => p.id === id) ?? null),

  /** 各图纸的进程数（列表角标用）。 */
  processCounts: () => {
    const counts: Record<string, number> = {};
    for (const p of processes) counts[p.blueprintId] = (counts[p.blueprintId] ?? 0) + 1;
    return delay(counts);
  },

  /** 某进程的运行记录（分页，按开始时间倒序）。page 越界时收敛到合法区间。 */
  listRuns: (processId: string, page: number): Promise<Paged<Run>> => {
    const all = runs
      .filter((r) => r.processId === processId)
      .sort((a, b) => b.startedAt - a.startedAt);
    const total = all.length;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safe = Math.min(Math.max(1, page), pageCount);
    const items = all.slice((safe - 1) * PAGE_SIZE, safe * PAGE_SIZE);
    return delay({ items, total, page: safe, pageCount });
  },

  /** 某进程的运行聚合统计（页头指标条用，对应后端一个聚合端点）。 */
  runStats: (processId: string): Promise<RunStats> => {
    const all = runs.filter((r) => r.processId === processId);
    const completed = all.filter((r) => r.status === 'completed').length;
    const failed = all.filter((r) => r.status === 'failed').length;
    const running = all.filter((r) => r.status === 'running').length;
    const settled = completed + failed;
    const durations = all
      .filter((r) => r.finishedAt != null)
      .map((r) => (r.finishedAt! - r.startedAt) / 1000);
    const lastFailedAt = all
      .filter((r) => r.status === 'failed')
      .reduce<
        number | null
      >((max, r) => (max == null || r.startedAt > max ? r.startedAt : max), null);
    return delay({
      total: all.length,
      completed,
      failed,
      running,
      successRate: settled > 0 ? completed / settled : null,
      avgDurationSec:
        durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      lastFailedAt,
    });
  },

  /** 单条运行的详情：运行 + 任务树（每任务含环节）。下钻星图用。 */
  getRunDetail: (runId: string): Promise<RunDetail | null> => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return delay(null);
    return delay({ run, tasks: buildRunTasks(run) });
  },

  // ─── 图纸写 ──────────────────────────────────────────────────────────────

  createBlueprint: (input: {
    kind: BlueprintKind;
    label: string;
    note?: string;
    sources: SourceSelection[];
    params: Blueprint['params'];
    flow: Blueprint['flow'];
  }) => {
    const ts = Date.now();
    const bp: Blueprint = { id: nextId('bp'), ...input, createdAt: ts, updatedAt: ts };
    blueprints.push(bp);
    return delay(bp);
  },

  updateBlueprint: (id: string, patch: Partial<Omit<Blueprint, 'id' | 'createdAt'>>) => {
    const bp = blueprints.find((b) => b.id === id);
    if (!bp) throw new Error('图纸不存在');
    Object.assign(bp, patch, { updatedAt: Date.now() });
    return delay(bp);
  },

  deleteBlueprint: (id: string) => {
    const idx = blueprints.findIndex((b) => b.id === id);
    if (idx >= 0) blueprints.splice(idx, 1);
    // 级联删进程与运行
    for (let i = processes.length - 1; i >= 0; i--)
      if (processes[i]!.blueprintId === id) processes.splice(i, 1);
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i]!.blueprintId === id) runs.splice(i, 1);
    return delay({ ok: true });
  },

  // ─── 进程写 ──────────────────────────────────────────────────────────────

  createProcess: (input: { blueprintId: string; label: string; trigger: TriggerConfig }) => {
    const ts = Date.now();
    const p: Process = {
      id: nextId('pr'),
      blueprintId: input.blueprintId,
      label: input.label,
      trigger: input.trigger,
      status: 'active',
      createdAt: ts,
      lastRunAt: null,
      nextRunAt: computeNextRun(input.trigger, ts),
      sweepSeq: 0,
      runsTotal: 0,
    };
    processes.push(p);
    return delay(p);
  },

  updateProcess: (id: string, patch: { label?: string; trigger?: TriggerConfig }) => {
    const p = processes.find((x) => x.id === id);
    if (!p) throw new Error('进程不存在');
    if (patch.label !== undefined) p.label = patch.label;
    if (patch.trigger !== undefined) {
      p.trigger = patch.trigger;
      if (p.status === 'active') p.nextRunAt = computeNextRun(patch.trigger, Date.now());
    }
    return delay(p);
  },

  setProcessStatus: (id: string, status: Process['status']) => {
    const p = processes.find((x) => x.id === id);
    if (!p) throw new Error('进程不存在');
    p.status = status;
    p.nextRunAt = status === 'active' ? computeNextRun(p.trigger, Date.now()) : null;
    return delay(p);
  },

  deleteProcess: (id: string) => {
    const idx = processes.findIndex((x) => x.id === id);
    if (idx >= 0) processes.splice(idx, 1);
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i]!.processId === id) runs.splice(i, 1);
    return delay({ ok: true });
  },

  /** 立即触发一次：造一条完成的运行、推进 lastRun/nextRun（让节奏「跑起来」可感）。 */
  triggerNow: (id: string) => {
    const p = processes.find((x) => x.id === id);
    if (!p) throw new Error('进程不存在');
    const bp = blueprints.find((b) => b.id === p.blueprintId)!;
    const ts = Date.now();
    const total = bp.kind === 'recheck' ? (p.trigger.kind === 'interval' ? 20 : 20) : 18;
    const skipped = bp.kind === 'recheck' ? 13 : 0;
    if (bp.kind === 'recheck') p.sweepSeq += 1;
    const run: Run = {
      id: nextId('run'),
      processId: p.id,
      blueprintId: p.blueprintId,
      kind: bp.kind,
      status: 'completed',
      triggerSource: 'manual',
      error: null,
      sweepSeq: bp.kind === 'recheck' ? p.sweepSeq : null,
      tasksTotal: total,
      tasksDone: total - skipped,
      tasksSkipped: skipped,
      tasksFailed: 0,
      startedAt: ts,
      finishedAt: ts + 2 * MIN,
    };
    runs.push(run);
    p.lastRunAt = ts;
    p.runsTotal += 1;
    if (p.status === 'completed') p.status = 'active';
    p.nextRunAt = computeNextRun(p.trigger, ts);
    return delay(run);
  },
};
