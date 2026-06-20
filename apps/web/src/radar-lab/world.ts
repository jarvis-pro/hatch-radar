/**
 * 雷达指挥室（radar-lab）—— 种子世界。
 *
 * `createInitialWorld()` 每次返回一个**全新独立**的 World（对象都现造，便于 reset 不串状态）。
 * 进程 `nextRunAt` 设为「种子时刻 + 几秒」→ 引擎在加载后很快自动开第一条运行，页面立刻「活」起来。
 * 另播种若干历史完成运行 + 洞察，使「运行历史 / 收成」开局非空。
 */
import { DEFAULT_COLLECT_PARAMS, DEFAULT_LANES, DEFAULT_RECHECK_PARAMS } from './constants';
import { POSTS } from './corpus';
import type { Blueprint, Comment, Insight, Lane, Post, Process, Run, World } from './types';

const MIN = 60_000;

/** 抹掉帖子预置译文（标题 / 正文 / 各级评论）——「待发现」池默认未翻译，开了翻译环节才补中文。 */
function stripZh(p: Post): Post {
  const strip = (cs: Comment[]): Comment[] =>
    cs.map((c) => ({
      ...c,
      bodyZh: undefined,
      children: c.children ? strip(c.children) : undefined,
    }));
  return { ...p, titleZh: undefined, bodyZh: undefined, comments: strip(p.comments) };
}

export function createInitialWorld(): World {
  const now = Date.now();

  const blueprints: Blueprint[] = [
    {
      id: 'bp_saas',
      kind: 'collect',
      label: 'Reddit · SaaS 选区采集',
      note: '主力采集线，覆盖核心创业 / SaaS 版块',
      sources: [{ kind: 'reddit', channels: ['r/SaaS', 'r/startups', 'r/Entrepreneur'] }],
      params: { ...DEFAULT_COLLECT_PARAMS },
      gates: [],
      enabledStages: ['collect:translate'], // 主力线默认开翻译——采进来的新帖会补中文
    },
    {
      id: 'bp_hn',
      kind: 'collect',
      label: '只抓 Hacker News',
      note: '单渠道图纸示例',
      sources: [{ kind: 'hackernews', channels: ['front', 'new'] }],
      params: { limit: 60, stopAfterKnown: 8, commentBudget: 150 },
      gates: [],
    },
    {
      id: 'bp_recheck',
      kind: 'recheck',
      label: '热帖复查',
      note: '只查已入库旧帖、探评论变化；指数退避封顶',
      sources: [{ kind: 'reddit', channels: ['r/SaaS', 'r/startups'] }],
      params: { ...DEFAULT_RECHECK_PARAMS },
      gates: [],
    },
  ];

  // 演示节奏：短间隔 + 错峰起跑，让世界几乎持续有活动（节奏由 triggerSummary 显示，label 不再重复）。
  const processes: Process[] = [
    {
      id: 'pr_saas',
      blueprintId: 'bp_saas',
      label: 'SaaS 采集',
      trigger: { kind: 'interval', everySec: 60 },
      status: 'active',
      lastRunAt: now - 12 * MIN,
      nextRunAt: now + 3000, // 加载后 ~3 sim 秒自动开跑
      sweepSeq: 0,
      runsTotal: 412,
    },
    {
      id: 'pr_hn',
      blueprintId: 'bp_hn',
      label: 'HN 采集',
      trigger: { kind: 'interval', everySec: 90 },
      status: 'active',
      lastRunAt: now - 4 * MIN,
      nextRunAt: now + 9000,
      sweepSeq: 0,
      runsTotal: 561,
    },
    {
      id: 'pr_recheck',
      blueprintId: 'bp_recheck',
      label: '热帖复查',
      trigger: { kind: 'interval', everySec: 120 },
      status: 'active',
      lastRunAt: now - 38 * MIN,
      nextRunAt: now + 18000,
      sweepSeq: 73,
      runsTotal: 73,
    },
  ];

  const lanes: Lane[] = DEFAULT_LANES.map((l) => ({
    ...l,
    tokens: l.burst,
    paused: false,
    recentReleases: [],
  }));

  // 前 6 帖作「已采集」（带历史洞察、保留译文作存量），其余作「待发现」池（抹译文，待翻译环节补）。
  const posts = POSTS.slice(0, 6).map((p) => ({ ...p }));
  const undiscovered = POSTS.slice(6).map((p) => stripZh({ ...p }));

  // 历史完成运行（pr_saas 最近 3 轮），让运行历史开局非空。
  const runs: Run[] = [1, 2, 3].map((i) => ({
    id: `run_h${i}`,
    processId: 'pr_saas',
    blueprintId: 'bp_saas',
    kind: 'collect',
    status: i === 2 ? 'failed' : 'completed',
    triggerSource: 'interval',
    sweepSeq: null,
    error: i === 2 ? 'Reddit 403 —— 部分版块需登录或已转私有' : null,
    startedAt: now - (i * 30 + 6) * MIN,
    finishedAt: now - (i * 30 + 2) * MIN,
  }));

  // 历史洞察（绑已采集帖 + 历史运行 run_h1），让「收成」开局非空、可溯源。
  const seedInsights: Array<
    Pick<Insight, 'postId' | 'intensity' | 'painPoint' | 'tags' | 'painCount' | 'oppCount'>
  > = [
    {
      postId: 't3_saas01',
      intensity: 'high',
      painPoint: '用户激活后很快流失——产品没进入日常工作流，提醒/邮件都无效。',
      tags: ['churn', 'onboarding', 'retention'],
      painCount: 3,
      oppCount: 2,
    },
    {
      postId: 't3_saas04',
      intensity: 'high',
      painPoint: 'AI 功能抬高了用户预期却兑现不了，支持工单量翻倍。',
      tags: ['ai-feature', 'support-load', 'expectations'],
      painCount: 2,
      oppCount: 2,
    },
    {
      postId: 't3_saas02',
      intensity: 'medium',
      painPoint: '小额订单下 Stripe 固定 30c 手续费占比过高，吞掉利润。',
      tags: ['payments', 'fees', 'micro-saas'],
      painCount: 1,
      oppCount: 1,
    },
    {
      postId: 't3_saas06',
      intensity: 'medium',
      painPoint: '定价锚定——砍掉最低档反而提升了向上转化。',
      tags: ['pricing', 'anchoring', 'conversion'],
      painCount: 1,
      oppCount: 3,
    },
    {
      postId: 't3_saas05',
      intensity: 'low',
      painPoint: '开源核心是否会侵蚀付费层的长期疑虑。',
      tags: ['open-source', 'monetization'],
      painCount: 1,
      oppCount: 2,
    },
  ];

  const insights: Insight[] = seedInsights.map((s, i) => {
    const post = posts.find((p) => p.id === s.postId)!;
    return {
      id: `ins_h${i + 1}`,
      postId: s.postId,
      runId: 'run_h1',
      processId: 'pr_saas',
      blueprintId: 'bp_saas',
      source: post.source,
      channel: post.channel,
      postTitle: post.title,
      intensity: s.intensity,
      painPoint: s.painPoint,
      tags: s.tags,
      painCount: s.painCount,
      oppCount: s.oppCount,
      createdAt: now - (60 + i * 14) * MIN,
    };
  });

  return {
    nowMs: now,
    blueprints,
    processes,
    runs,
    tasks: [],
    requests: [],
    lanes,
    insights,
    posts,
    undiscovered,
    seq: 1000,
  };
}
