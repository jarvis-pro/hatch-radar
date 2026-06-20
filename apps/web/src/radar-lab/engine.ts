/**
 * 雷达指挥室（radar-lab）—— 模拟引擎。
 *
 * `tick(world, dtMs)` 是纯粹的世界推进状态机（就地改 world）。每帧：
 *   推进 sim 时钟 → 补 lane 令牌 → 到点开运行 → 逐任务推进环节 → 请求闸放行/完成 → 收尾运行。
 *
 * 关键因果：fetch 环节不直接「耗时完成」，而是往 requestQueue 推一行、停在 waiting；
 * 必须 lane 未暂停且有令牌才被放行（running）→ 跑满 costMs → done → 该环节 done。
 * 于是「暂停某 lane → 抓取环节 park → 运行变慢」天然成立。
 */
import { STAGE_TEMPLATES, sourceToLane } from './constants';
import type {
  Blueprint,
  Intensity,
  Insight,
  LaneId,
  Post,
  RecheckParams,
  RequestRow,
  Run,
  SourceKind,
  Stage,
  Task,
  TaskKind,
  World,
} from './types';

// ─── 小工具 ────────────────────────────────────────────────────────────────────

function nextId(world: World, prefix: string): string {
  world.seq += 1;
  return `${prefix}_${world.seq.toString(36)}`;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function firstSentence(body: string, fallback: string): string {
  const t = body.trim();
  if (!t) return fallback;
  const m = /^.*?[.!?](\s|$)/.exec(t);
  const s = (m ? m[0] : t).trim();
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

function intensityFor(score: number): Intensity {
  return score >= 350 ? 'high' : score >= 150 ? 'medium' : 'low';
}

const THEME: [RegExp, string][] = [
  [/churn|retention|forget|ghost/i, 'churn'],
  [/pricing|price|tier|fees|stripe|payment/i, 'pricing'],
  [/\bai\b|assistant/i, 'ai'],
  [/cold email|outbound|deliverab/i, 'outbound'],
  [/open.?source|oss/i, 'open-source'],
  [/free tier|free plan|abuser/i, 'free-tier'],
  [/support|ticket/i, 'support'],
  [/onboard|activation/i, 'onboarding'],
  [/concentration|mrr|revenue/i, 'revenue-risk'],
  [/platform|\bcli\b/i, 'dx'],
  [/postgres|realtime|\bapi\b/i, 'infra'],
];

function tagsFor(post: Post): string[] {
  const hay = `${post.title} ${post.body}`;
  const tags = THEME.filter(([re]) => re.test(hay)).map(([, t]) => t);
  return tags.length ? tags.slice(0, 4) : [post.channel];
}

// 待发现池耗尽时合成新帖，让采集可持续产出。
const SYNTH: { source: SourceKind; channel: string; title: string; body: string; score: number; numComments: number; commentDepth: number }[] =
  [
    {
      source: 'reddit',
      channel: 'r/SaaS',
      title: 'Trial-to-paid stuck at 2% — what finally moved it for you?',
      body: 'Tons of trials, almost nobody upgrades. We gate features, send emails… still 2%. What actually worked?',
      score: 156,
      numComments: 44,
      commentDepth: 2,
    },
    {
      source: 'reddit',
      channel: 'r/startups',
      title: 'Investor wants 30% — is it ever worth it at pre-seed?',
      body: 'First check, big name, but 30% feels brutal this early. How did you think about it?',
      score: 233,
      numComments: 61,
      commentDepth: 2,
    },
    {
      source: 'reddit',
      channel: 'r/Entrepreneur',
      title: 'I automated my whole support queue and customers hate it',
      body: 'Full AI support. CSAT tanked. Turns out people want a human for billing issues specifically.',
      score: 188,
      numComments: 52,
      commentDepth: 2,
    },
    {
      source: 'hackernews',
      channel: 'new',
      title: 'Ask HN: How do you price a developer tool nobody has seen before?',
      body: 'New category, no comparables. Seat-based? Usage? Flat? Lost on where to even start.',
      score: 174,
      numComments: 98,
      commentDepth: 2,
    },
    {
      source: 'reddit',
      channel: 'r/SaaS',
      title: 'Annual plans saved our cash flow but killed our churn signal',
      body: 'Everyone on annual now. Cash is great, but we only learn about unhappy customers at renewal — too late.',
      score: 142,
      numComments: 37,
      commentDepth: 1,
    },
    {
      source: 'hackernews',
      channel: 'front',
      title: 'Show HN: A tiny CLI that diffs two API responses semantically',
      body: '',
      score: 421,
      numComments: 130,
      commentDepth: 3,
    },
  ];

function synthPost(world: World, prefer: SourceKind[]): Post {
  const pool = SYNTH.filter((s) => prefer.includes(s.source));
  const list = pool.length ? pool : SYNTH;
  const base = list[world.seq % list.length]!;
  const n = world.seq;
  return {
    id: nextId(world, base.source === 'hackernews' ? 'hn' : 't3'),
    source: base.source,
    channel: base.channel,
    title: base.title,
    body: base.body,
    author: `user_${(n % 900) + 100}`,
    score: base.score + (n % 40),
    numComments: base.numComments + (n % 12),
    commentDepth: base.commentDepth,
    ageMinutes: 1 + (n % 9),
    comments: base.body
      ? [{ author: 'commenter', score: 10 + (n % 30), depth: 0, body: 'This resonates — we hit the same wall.' }]
      : [],
  };
}

// ─── 任务 / 运行创建 ────────────────────────────────────────────────────────────

function buildStages(world: World, kind: TaskKind, blueprint: Blueprint | undefined, post: Post | null): Stage[] {
  const sourceLane: LaneId | undefined = post
    ? sourceToLane(post.source)
    : blueprint
      ? sourceToLane(blueprint.sources[0]!.kind)
      : undefined;
  return STAGE_TEMPLATES[kind].map((def, i) => ({
    seq: i,
    name: def.name,
    status: 'pending',
    gate: blueprint?.gates.includes(def.name) ?? false,
    costMs: def.costMs,
    elapsedMs: 0,
    lane: def.fetch === 'ai' ? 'ai' : def.fetch === 'source' ? sourceLane : undefined,
    output: null,
    error: null,
  }));
}

function createTask(world: World, run: Run, kind: TaskKind, post: Post | null, parentId: string | null): Task {
  const blueprint = world.blueprints.find((b) => b.id === run.blueprintId);
  const task: Task = {
    id: nextId(world, 'task'),
    runId: run.id,
    processId: run.processId,
    kind,
    status: 'queued',
    parentId,
    postId: post?.id ?? null,
    post,
    stages: buildStages(world, kind, blueprint, post),
    attempts: 0,
    enqueuedAt: world.nowMs,
    startedAt: null,
    finishedAt: null,
  };
  world.tasks.push(task);
  return task;
}

/** 开一条运行（手动 / 调度触发共用）。 */
export function startRun(world: World, processId: string, triggerSource: Run['triggerSource']): Run | null {
  const process = world.processes.find((p) => p.id === processId);
  if (!process) return null;
  const blueprint = world.blueprints.find((b) => b.id === process.blueprintId);
  if (!blueprint) return null;

  const run: Run = {
    id: nextId(world, 'run'),
    processId: process.id,
    blueprintId: blueprint.id,
    kind: blueprint.kind,
    status: 'running',
    triggerSource,
    sweepSeq: blueprint.kind === 'recheck' ? (process.sweepSeq += 1) : null,
    error: null,
    startedAt: world.nowMs,
    finishedAt: null,
  };
  world.runs.push(run);
  process.lastRunAt = world.nowMs;
  process.runsTotal += 1;
  process.nextRunAt = null; // 跑完再排下一轮

  if (blueprint.kind === 'collect') {
    createTask(world, run, 'discover', null, null);
  } else {
    const kinds = blueprint.sources.map((s) => s.kind);
    const batchSize = (blueprint.params as RecheckParams).batchSize ?? 12;
    const sweep = run.sweepSeq ?? 0;
    // 到期集合：recheckDueSweep ≤ 当前 sweep（指数退避驱动）
    const due = world.posts
      .filter((p) => kinds.includes(p.source) && (p.recheckDueSweep ?? 0) <= sweep)
      .slice(0, batchSize);
    if (due.length === 0) {
      run.status = 'completed';
      run.finishedAt = world.nowMs;
    } else {
      for (const post of due) createTask(world, run, 'recheck', post, null);
    }
  }
  return run;
}

// ─── 环节产物文案 ───────────────────────────────────────────────────────────────

function stageOutput(world: World, task: Task, stage: Stage): string {
  const post = task.post;
  switch (stage.name) {
    case 'fetch_listing':
      return '抓取列表页 · 候选已取';
    case 'dedup':
      return '候选反连接 posts ∪ 活跃任务';
    case 'spawn':
      return '派生采集子任务';
    case 'fetch_detail':
      return '帖子详情已取';
    case 'fetch_comments':
      return post ? `评论 ${post.numComments} 条 · 最深 ${post.commentDepth} 层` : '评论已取';
    case 'probe':
      return post ? `源现网评论 ${post.numComments} 条` : '源计数已取';
    case 'detect':
      return '比对基线';
    case 'recrawl':
      return '全量重抓评论 · replaceComments';
    case 'resolve':
      return '取帖 + provider 快照';
    case 'fetch':
      return '取评论上下文';
    case 'context':
      return '组装 prompt 上下文';
    case 'ai_call':
      return 'AI 产出洞察草稿（原始响应已落检查点）';
    case 'normalize':
      return '归一化洞察 schema';
    case 'persist':
      if (task.kind === 'analyze') return '洞察落库（按 post_id 幂等）';
      return '入库 + 刷新评论基线';
    default:
      return '完成';
  }
}

// ─── 任务推进 ──────────────────────────────────────────────────────────────────

function currentStage(task: Task): Stage | undefined {
  return task.stages.find(
    (s) => s.status === 'pending' || s.status === 'running' || s.status === 'waiting',
  );
}

function beginStage(world: World, task: Task, stage: Stage): void {
  if (stage.lane) {
    // fetch 环节：入请求闸，停在 waiting 等放行
    const req: RequestRow = {
      id: nextId(world, 'req'),
      lane: stage.lane,
      purpose: stage.name,
      taskId: task.id,
      stageSeq: stage.seq,
      postId: task.postId,
      status: 'pending',
      costMs: stage.costMs,
      enqueuedAt: world.nowMs,
      releasedAt: null,
      finishedAt: null,
      detail: task.post ? `${task.post.channel} · ${stage.name}` : stage.name,
    };
    world.requests.push(req);
    stage.requestId = req.id;
    stage.status = 'waiting';
  } else {
    stage.status = 'running';
    stage.elapsedMs = 0;
  }
}

function onStageComplete(world: World, task: Task, stage: Stage): void {
  stage.status = 'done';
  stage.requestId = undefined;
  stage.output = stageOutput(world, task, stage);
  // 副作用挂在有意义的环节上
  if (stage.name === 'spawn') doDiscover(world, task, stage);
  else if (stage.name === 'detect') doDetect(world, task, stage);
  else if (stage.name === 'persist') {
    if (task.kind === 'collect' || task.kind === 'recheck') spawnAnalyze(world, task);
    else if (task.kind === 'analyze') emitInsight(world, task);
  }
}

function doDiscover(world: World, task: Task, stage: Stage): void {
  const run = world.runs.find((r) => r.id === task.runId);
  const blueprint = run && world.blueprints.find((b) => b.id === run.blueprintId);
  if (!run || !blueprint) return;
  const kinds = blueprint.sources.map((s) => s.kind);
  const k = 2 + (world.seq % 3); // 2~4 条
  let found = 0;
  for (let i = 0; i < k; i++) {
    let post = world.undiscovered.find((p) => kinds.includes(p.source));
    if (post) world.undiscovered = world.undiscovered.filter((p) => p !== post);
    else post = synthPost(world, kinds);
    world.posts.push(post);
    createTask(world, run, 'collect', post, task.id);
    found++;
  }
  stage.output = `发现 ${found} 条新帖 · 派生采集`;
}

function doDetect(world: World, task: Task, stage: Stage): void {
  const run = world.runs.find((r) => r.id === task.runId);
  const blueprint = run && world.blueprints.find((b) => b.id === run.blueprintId);
  const sweep = run?.sweepSeq ?? 0;
  const cap = blueprint ? ((blueprint.params as RecheckParams).backoffCap ?? 16) : 16;
  const post = task.post;
  // 帖级波动性 + sweep 决定有无变化（约 1/4 概率变化）
  const changed = post ? hashStr(`${post.id}:${sweep}`) % 4 === 0 : false;
  if (post) post.lastRecheckedSweep = sweep;
  if (changed) {
    if (post) {
      post.recheckMisses = 0;
      post.recheckDueSweep = sweep + 1; // 复位：下轮必查
    }
    stage.output = '有变化 · 触发重抓 + 重新分析（退避复位）';
  } else {
    let skip = 1;
    if (post) {
      post.recheckMisses = (post.recheckMisses ?? 0) + 1;
      skip = Math.min(2 ** (post.recheckMisses - 1), cap); // 1,2,4,…,CAP
      post.recheckDueSweep = sweep + skip;
    }
    stage.output = `未变化 · 连续未变 ${post?.recheckMisses ?? 1} 次，退避跳过 ${skip} 轮`;
    // 跳过 recrawl + persist，任务整体 skipped
    for (const s of task.stages) if (s.status === 'pending') s.status = 'skipped';
    task.status = 'skipped';
    task.finishedAt = world.nowMs;
  }
}

function spawnAnalyze(world: World, task: Task): void {
  const run = world.runs.find((r) => r.id === task.runId);
  if (!run || !task.post) return;
  createTask(world, run, 'analyze', task.post, task.id);
}

function emitInsight(world: World, task: Task): void {
  const post = task.post;
  if (!post) return;
  const intensity = intensityFor(post.score);
  const insight: Insight = {
    id: nextId(world, 'ins'),
    postId: post.id,
    runId: task.runId,
    processId: task.processId,
    blueprintId: world.runs.find((r) => r.id === task.runId)?.blueprintId ?? '',
    source: post.source,
    channel: post.channel,
    postTitle: post.title,
    intensity,
    painPoint: firstSentence(post.body, post.title),
    tags: tagsFor(post),
    painCount: intensity === 'high' ? 3 : intensity === 'medium' ? 2 : 1,
    oppCount: 1 + (hashStr(post.id) % 3),
    createdAt: world.nowMs,
  };
  world.insights.unshift(insight);
}

function finishTaskSuccess(world: World, task: Task): void {
  task.status = 'succeeded';
  task.finishedAt = world.nowMs;
}

function advanceTask(world: World, task: Task, dtMs: number): void {
  if (task.status === 'queued') {
    task.status = 'running';
    task.startedAt = world.nowMs;
  }
  if (task.status !== 'running') return;

  const stage = currentStage(task);
  if (!stage) {
    finishTaskSuccess(world, task);
    return;
  }
  switch (stage.status) {
    case 'pending':
      if (stage.gate) {
        task.status = 'paused'; // 跑到挂闸环节即停，等放行
        return;
      }
      beginStage(world, task, stage);
      break;
    case 'running':
      stage.elapsedMs += dtMs;
      if (stage.elapsedMs >= stage.costMs) onStageComplete(world, task, stage);
      break;
    case 'waiting':
      // fetch 环节：等请求闸放行 + 完成（见 completeRequests），此处不动
      break;
  }
}

// ─── 请求闸（lane 限速 / 放行 / 完成） ─────────────────────────────────────────

function refillLanes(world: World, dtMs: number): void {
  for (const lane of world.lanes) {
    lane.tokens = Math.min(lane.burst, lane.tokens + (lane.ratePerMin / 60_000) * dtMs);
  }
}

function releaseRequests(world: World): void {
  for (const lane of world.lanes) {
    if (lane.paused) continue;
    const pending = world.requests
      .filter((r) => r.lane === lane.id && r.status === 'pending')
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    for (const r of pending) {
      if (lane.tokens < 1) break;
      lane.tokens -= 1;
      r.status = 'running';
      r.releasedAt = world.nowMs;
      lane.recentReleases.push(world.nowMs);
    }
  }
}

function completeRequests(world: World): void {
  for (const r of world.requests) {
    if (r.status !== 'running' || r.releasedAt == null) continue;
    if (world.nowMs - r.releasedAt < r.costMs) continue;
    r.status = 'done';
    r.finishedAt = world.nowMs;
    const task = world.tasks.find((t) => t.id === r.taskId);
    const stage = task?.stages.find((s) => s.seq === r.stageSeq);
    if (task && stage && task.status === 'running' && stage.status === 'waiting' && stage.requestId === r.id) {
      onStageComplete(world, task, stage);
    }
  }
}

// ─── 运行调度 / 收尾 ────────────────────────────────────────────────────────────

function startDueRuns(world: World): void {
  for (const process of world.processes) {
    if (process.status !== 'active' || process.nextRunAt == null) continue;
    if (world.nowMs < process.nextRunAt) continue;
    const hasActive = world.runs.some((r) => r.processId === process.id && r.status === 'running');
    if (hasActive) continue;
    const src: Run['triggerSource'] = process.trigger.kind === 'cron' ? 'cron' : 'interval';
    startRun(world, process.id, src);
  }
}

const TERMINAL: Task['status'][] = ['succeeded', 'skipped', 'failed', 'canceled'];

function finalizeRuns(world: World): void {
  for (const run of world.runs) {
    if (run.status !== 'running') continue;
    const tasks = world.tasks.filter((t) => t.runId === run.id);
    if (tasks.length === 0) continue;
    if (!tasks.every((t) => TERMINAL.includes(t.status))) continue;
    run.status = tasks.some((t) => t.status === 'failed') ? 'failed' : 'completed';
    run.finishedAt = world.nowMs;
    if (run.status === 'failed') run.error = '部分任务失败（见任务树）';
    // 排下一轮
    const process = world.processes.find((p) => p.id === run.processId);
    if (process && process.status === 'active') {
      const t = process.trigger;
      if (t.kind === 'interval') process.nextRunAt = world.nowMs + t.everySec * 1000;
      else if (t.kind === 'cron') process.nextRunAt = world.nowMs + 3600_000;
      else process.nextRunAt = null;
    }
  }
}

function trim(world: World): void {
  const cutoff = world.nowMs - 90_000;
  world.requests = world.requests.filter(
    (r) => !((r.status === 'done' || r.status === 'failed') && (r.finishedAt ?? 0) < cutoff),
  );
  for (const lane of world.lanes) {
    lane.recentReleases = lane.recentReleases.filter((ts) => ts > world.nowMs - 60_000);
  }
}

// ─── 主推进 ────────────────────────────────────────────────────────────────────

export function tick(world: World, dtMs: number): void {
  world.nowMs += dtMs;
  refillLanes(world, dtMs);
  startDueRuns(world);
  for (const task of world.tasks) {
    if (task.status === 'queued' || task.status === 'running') advanceTask(world, task, dtMs);
  }
  releaseRequests(world);
  completeRequests(world);
  finalizeRuns(world);
  trim(world);
}
