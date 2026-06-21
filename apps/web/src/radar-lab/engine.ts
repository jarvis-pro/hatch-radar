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
import { gateKey, STAGE_TEMPLATES, sourceToLane } from './constants';
import { POSTS } from './corpus';
import type {
  Blueprint,
  Comment,
  Intensity,
  Insight,
  LaneId,
  Post,
  Process,
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
const SYNTH: {
  source: SourceKind;
  channel: string;
  title: string;
  titleZh: string;
  body: string;
  bodyZh: string;
  score: number;
  numComments: number;
  commentDepth: number;
}[] = [
  {
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'Trial-to-paid stuck at 2% — what finally moved it for you?',
    titleZh: '试用转付费卡在 2%——你们最后靠什么撬动的？',
    body: 'Tons of trials, almost nobody upgrades. We gate features, send emails… still 2%. What actually worked?',
    bodyZh: '试用一大堆，几乎没人升级。功能设了闸、邮件也发了……还是 2%。到底什么管用？',
    score: 156,
    numComments: 44,
    commentDepth: 2,
  },
  {
    source: 'reddit',
    channel: 'r/startups',
    title: 'Investor wants 30% — is it ever worth it at pre-seed?',
    titleZh: '投资人要 30%——种子前阶段这值得吗？',
    body: 'First check, big name, but 30% feels brutal this early. How did you think about it?',
    bodyZh: '第一张支票、名头很大，但这么早就 30% 太狠了。你们当时怎么权衡的？',
    score: 233,
    numComments: 61,
    commentDepth: 2,
  },
  {
    source: 'reddit',
    channel: 'r/Entrepreneur',
    title: 'I automated my whole support queue and customers hate it',
    titleZh: '我把整个客服队列自动化了，结果客户恨死了',
    body: 'Full AI support. CSAT tanked. Turns out people want a human for billing issues specifically.',
    bodyZh: '全 AI 客服。CSAT 暴跌。原来一到账单问题，用户就是想找真人。',
    score: 188,
    numComments: 52,
    commentDepth: 2,
  },
  {
    source: 'hackernews',
    channel: 'new',
    title: 'Ask HN: How do you price a developer tool nobody has seen before?',
    titleZh: 'Ask HN：一个前所未见的开发者工具，定价怎么定？',
    body: 'New category, no comparables. Seat-based? Usage? Flat? Lost on where to even start.',
    bodyZh: '全新品类，没有可对标的。按席位？按用量？一口价？连从哪下手都没头绪。',
    score: 174,
    numComments: 98,
    commentDepth: 2,
  },
  {
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'Annual plans saved our cash flow but killed our churn signal',
    titleZh: '年付救了现金流，却毁了我们的流失信号',
    body: 'Everyone on annual now. Cash is great, but we only learn about unhappy customers at renewal — too late.',
    bodyZh: '现在大家都年付。现金很爽，但我们只有到续费时才知道哪些客户不满——太晚了。',
    score: 142,
    numComments: 37,
    commentDepth: 1,
  },
  {
    source: 'hackernews',
    channel: 'front',
    title: 'Show HN: A tiny CLI that diffs two API responses semantically',
    titleZh: 'Show HN：一个语义化对比两个 API 响应的小 CLI',
    body: 'Built this after diffing JSON by eye one too many times. Ignores key order, flags only semantic changes. Feedback welcome.',
    bodyZh: '盯着 JSON 用肉眼比对了太多次之后做了这个。忽略键顺序、只标出语义层面的变化。欢迎反馈。',
    score: 421,
    numComments: 130,
    commentDepth: 3,
  },
  {
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'We raised prices 40% and lost only 3 customers — best decision ever',
    titleZh: '我们涨价 40%、只流失了 3 个客户——这是做过最对的决定',
    body: 'Terrified before pulling the trigger. Net revenue up 35%, churn barely moved. Should have done it a year ago.',
    bodyZh: '动手前怕得要死。结果净收入涨了 35%、流失几乎没动。早该一年前就做了。',
    score: 268,
    numComments: 73,
    commentDepth: 2,
  },
  {
    source: 'reddit',
    channel: 'r/startups',
    title: 'Cofounder wants to keep his day job, I went full-time. How do we split equity?',
    titleZh: '联创想保留正职、我已经全职。股权到底怎么分？',
    body: 'Same idea, very different risk. 50/50 feels wrong now but we agreed on it early. How did you handle this?',
    bodyZh: '一样的点子、却是天差地别的风险。现在觉得 50/50 不对劲，可当初是说好的。你们当时怎么处理的？',
    score: 197,
    numComments: 88,
    commentDepth: 2,
  },
  {
    source: 'reddit',
    channel: 'r/Entrepreneur',
    title: 'Spent $5k on ads and got 2 signups. What am I doing wrong?',
    titleZh: '投了 5000 美元广告、只换来 2 个注册。我到底哪儿做错了？',
    body: 'Targeting looked fine, landing page converts in tests. Burning cash with nothing to show. Where do I even start?',
    bodyZh: '定向看着没问题、落地页测试也能转化。钱在烧、却毫无产出。我该从哪下手？',
    score: 142,
    numComments: 56,
    commentDepth: 2,
  },
  {
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'Our onboarding is 12 steps and almost nobody finishes it',
    titleZh: '我们的新手引导有 12 步、几乎没人能走完',
    body: 'Funnel falls off a cliff at step 5. Cutting it to 4 steps next week and praying. Anyone measured the impact?',
    bodyZh: '漏斗在第 5 步断崖式流失。下周砍到 4 步、然后祈祷。有人量化过这么做的效果吗？',
    score: 211,
    numComments: 64,
    commentDepth: 2,
  },
  {
    source: 'reddit',
    channel: 'r/startups',
    title: 'Enterprise deal stuck in legal review for 4 months — is this normal?',
    titleZh: '一笔企业单子卡在法务审查 4 个月了——这正常吗？',
    body: 'Verbal yes back in spring. Now drowning in redlines and security questionnaires. Cash flow is getting scary.',
    bodyZh: '春天就口头答应了。现在淹没在红线批注和安全问卷里。现金流开始吓人了。',
    score: 158,
    numComments: 47,
    commentDepth: 1,
  },
  {
    source: 'reddit',
    channel: 'r/Entrepreneur',
    title: 'I fired my biggest client and revenue went up the next quarter',
    titleZh: '我炒掉了最大的客户、下个季度收入反而涨了',
    body: 'They were 40% of revenue and 90% of the stress. Freed-up capacity went to three saner accounts. No regrets.',
    bodyZh: '他们占了 40% 的收入、却占了 90% 的精力。腾出的人手接了三个省心的客户。毫不后悔。',
    score: 389,
    numComments: 102,
    commentDepth: 2,
  },
  {
    source: 'hackernews',
    channel: 'new',
    title: 'Show HN: Self-hosted analytics that respects privacy by default',
    titleZh: 'Show HN：默认尊重隐私的自托管分析工具',
    body: 'No cookies, no fingerprinting, single binary. Built it because every alternative wanted to monetize my visitors. MIT licensed.',
    bodyZh: '无 cookie、无指纹追踪、单文件部署。做它是因为每个替代品都盯着我访客的数据变现。MIT 许可。',
    score: 312,
    numComments: 95,
    commentDepth: 2,
  },
];

/** 合成帖评论池（en + zh）。帖上只挂英文原文（不预置 bodyZh），译文由翻译环节经 ZH_DICT 恢复——与"默认不翻"一致。 */
const SYNTH_COMMENTS: { en: string; zh: string }[] = [
  { en: 'This resonates — we hit the same wall.', zh: '深有同感——我们撞过同一堵墙。' },
  { en: 'Have you tried talking to the ones who churned?', zh: '你试过去找那些已经流失的用户聊聊吗？' },
  { en: 'Same here. Annual plans hid the problem for us too.', zh: '我们也一样。年付套餐把问题也给我们盖住了。' },
  { en: 'Curious what your activation metric looks like.', zh: '挺好奇你们的激活指标长什么样。' },
  { en: 'We fixed this with a weekly check-in email. Worked surprisingly well.', zh: '我们靠每周一封回访邮件解决了，效果出奇地好。' },
  { en: 'Pricing is rarely the real issue — positioning usually is.', zh: '定价很少是真问题——通常是定位出了问题。' },
  { en: 'Did the same last year. Best thing we ever shipped.', zh: '去年也这么干了，是我们做过最对的事。' },
  { en: 'Counterpoint: this only works if your retention is already solid.', zh: '反方观点：这只有在你的留存本就扎实时才管用。' },
];

function synthPost(world: World, prefer: SourceKind[]): Post {
  const pool = SYNTH.filter((s) => prefer.includes(s.source));
  const list = pool.length ? pool : SYNTH;
  const base = list[world.seq % list.length]!;
  const n = world.seq;
  // 造 3~5 条评论（其中一条可能带回复）——只挂英文原文，译文由翻译环节恢复。
  // numComments 仍取源站总数：体现采集按评论预算只采样了其中一部分（详情页"评论 N 条 · 源站共 M"）。
  const comments: Comment[] = [];
  const cCount = 3 + (n % 3);
  for (let i = 0; i < cCount; i++) {
    const cc = SYNTH_COMMENTS[(n + i) % SYNTH_COMMENTS.length]!;
    const node: Comment = {
      author: `user_${((n + i * 7) % 900) + 100}`,
      score: Math.max(1, 40 - i * 6 + (n % 13)),
      depth: 0,
      body: cc.en,
      ageMinutes: 4 + i * 5 + (n % 6),
    };
    if (i === 0 && base.commentDepth > 1) {
      const reply = SYNTH_COMMENTS[(n + 3) % SYNTH_COMMENTS.length]!;
      node.children = [
        {
          author: `user_${((n + 50) % 900) + 100}`,
          score: Math.max(1, 12 + (n % 9)),
          depth: 1,
          body: reply.en,
          ageMinutes: (node.ageMinutes ?? 0) + 6,
        },
      ];
    }
    comments.push(node);
  }
  // 新帖默认无译文（titleZh/bodyZh 留空）——开了翻译环节才由 doTranslate 经 ZH_DICT 补中文。
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
    comments,
  };
}

// ─── 任务 / 运行创建 ────────────────────────────────────────────────────────────

function buildStages(
  world: World,
  kind: TaskKind,
  blueprint: Blueprint | undefined,
  post: Post | null,
): Stage[] {
  const sourceLane: LaneId | undefined = post
    ? sourceToLane(post.source)
    : blueprint
      ? sourceToLane(blueprint.sources[0]!.kind)
      : undefined;
  // 可选环节（如翻译）：仅当图纸 enabledStages 含其复合键时才进入运行，否则根本不生成
  // （对应真实「默认不翻、按需开」）。seq 按过滤后下标连续编号，task 内自洽。
  const enabled = blueprint?.enabledStages ?? [];
  return STAGE_TEMPLATES[kind]
    .filter((def) => !def.optional || enabled.includes(gateKey(kind, def.name)))
    .map((def, i) => ({
      seq: i,
      name: def.name,
      status: 'pending',
      gate: blueprint?.gates.includes(gateKey(kind, def.name)) ?? false,
      costMs: def.costMs,
      elapsedMs: 0,
      lane: def.fetch === 'ai' ? 'ai' : def.fetch === 'source' ? sourceLane : undefined,
      output: null,
      error: null,
    }));
}

function createTask(
  world: World,
  run: Run,
  kind: TaskKind,
  post: Post | null,
  parentId: string | null,
): Task {
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

/**
 * 给进程排下一轮触发（interval/cron 续期，once 或已暂停则停）。
 * 运行正常收尾与「空轮立即完成」两处共用——避免空轮漏排导致进程 nextRunAt 永久为 null、自动调度停摆。
 */
function scheduleNext(world: World, process: Process): void {
  const t = process.trigger;
  if (process.status !== 'active' || t.kind === 'once') {
    process.nextRunAt = null;
    return;
  }
  process.nextRunAt = world.nowMs + (t.kind === 'interval' ? t.everySec * 1000 : 3600_000);
}

/** 开一条运行（手动 / 调度触发共用）。 */
export function startRun(
  world: World,
  processId: string,
  triggerSource: Run['triggerSource'],
): Run | null {
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
      // 无到期帖：本轮空跑即完成。务必补排下一轮——否则 nextRunAt 停在 null，
      // finalizeRuns 又只管 running 的 run，进程会就此永久停摆。
      run.status = 'completed';
      run.finishedAt = world.nowMs;
      scheduleNext(world, process);
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
    case 'translate':
      return '调用 AI 译为中文';
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
  else if (stage.name === 'translate') doTranslate(world, task, stage);
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
    // 痛点优先取正文首句；链接帖（无正文）退而取首条评论，避免痛点与标题原样重复。
    painPoint: post.body
      ? firstSentence(post.body, post.title)
      : firstSentence(post.comments[0]?.body ?? '', post.title),
    tags: tagsFor(post),
    painCount: intensity === 'high' ? 3 : intensity === 'medium' ? 2 : 1,
    oppCount: 1 + (hashStr(post.id) % 3),
    createdAt: world.nowMs,
  };
  world.insights.unshift(insight);
}

// ─── 翻译（可选环节产物） ───────────────────────────────────────────────────────

/** SYNTH 模板的原文→译文对照（标题 / 正文 / 示例评论），翻译环节据此查填精修译文。 */
const ZH_DICT = new Map<string, string>();
for (const s of SYNTH) {
  if (s.title) ZH_DICT.set(s.title, s.titleZh);
  if (s.body) ZH_DICT.set(s.body, s.bodyZh);
}
for (const c of SYNTH_COMMENTS) ZH_DICT.set(c.en, c.zh);
// corpus 帖的原文→译文：「待发现」池被 stripZh 抹了译文，翻译环节据此恢复真中文（而非占位）。
const collectCommentZh = (cs: Comment[]): void => {
  for (const cc of cs) {
    if (cc.body && cc.bodyZh) ZH_DICT.set(cc.body, cc.bodyZh);
    if (cc.children) collectCommentZh(cc.children);
  }
};
for (const p of POSTS) {
  if (p.title && p.titleZh) ZH_DICT.set(p.title, p.titleZh);
  if (p.body && p.bodyZh) ZH_DICT.set(p.body, p.bodyZh);
  collectCommentZh(p.comments);
}

/** mock 译文：命中对照表用精修中文，否则给规则化中文占位（演示「确实译了」而非真翻译）。 */
function mockZh(text: string): string {
  const hit = ZH_DICT.get(text);
  if (hit) return hit;
  const head = text.length > 48 ? `${text.slice(0, 48)}…` : text;
  return `〔中文译文〕${head}`;
}

/** 翻译环节：给帖标题 / 正文 + 各级评论补中文译文（已有则跳过）。 */
function doTranslate(world: World, task: Task, stage: Stage): void {
  const post = task.post;
  if (!post) return;
  let n = 0;
  if (post.title && !post.titleZh) {
    post.titleZh = mockZh(post.title);
    n++;
  }
  if (post.body && !post.bodyZh) {
    post.bodyZh = mockZh(post.body);
    n++;
  }
  const walk = (cs?: Comment[]): void => {
    if (!cs) return;
    for (const c of cs) {
      if (c.body && !c.bodyZh) {
        c.bodyZh = mockZh(c.body);
        n++;
      }
      walk(c.children);
    }
  };
  walk(post.comments);
  stage.output = `译为中文 · ${n} 段（标题 / 正文 / 评论）`;
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
    if (
      task &&
      stage &&
      task.status === 'running' &&
      stage.status === 'waiting' &&
      stage.requestId === r.id
    ) {
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
    // 排下一轮（与「空轮立即完成」共用 scheduleNext，逻辑单源）
    const process = world.processes.find((p) => p.id === run.processId);
    if (process) scheduleNext(world, process);
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
