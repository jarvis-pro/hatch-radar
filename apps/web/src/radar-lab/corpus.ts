/**
 * 雷达指挥室（radar-lab）—— 紧凑自包含语料（~12 帖，混合来源/评论深浅）。
 * 给任务挂真实内容；world 把前若干条作「已采集」、其余作「待发现」池（discover 从中发现新帖）。
 * 每帖 / 每评论带中文译文（titleZh/bodyZh）——演示「译文优先 + 切原文」。
 */
import type { Comment, Post } from './types';

const c = (
  author: string,
  score: number,
  depth: number,
  body: string,
  bodyZh: string,
  children?: Comment[],
): Comment => ({ author, score, depth, body, bodyZh, children });

// ── 评论生成器：保留手写特写评论，再按目标条数程序补量（有多有少，含嵌套，带译文） ──
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function countComments(nodes: Comment[]): number {
  let n = 0;
  for (const x of nodes) n += 1 + (x.children ? countComments(x.children) : 0);
  return n;
}

const GEN_AUTHORS = [
  'mvp_mike',
  'churn_doc',
  'pricing_nerd',
  'growth_lola',
  'bootstrap_ben',
  'seedstage_sue',
  'ops_oliver',
  'retention_ray',
  'funnel_fay',
  'cac_carl',
  'plg_pat',
  'arr_amy',
  'devtools_dan',
  'founder_fred',
  'lurker_lin',
  'skeptic_sam',
  'builder_bea',
  'vc_vince',
  'support_sid',
  'metrics_mei',
];
const GEN_POOL: { en: string; zh: string }[] = [
  {
    en: 'We hit the exact same wall last year — you are not alone.',
    zh: '我们去年也撞上了一模一样的墙——不止你一个。',
  },
  {
    en: 'Did you measure this against a control cohort? Easy to fool yourself otherwise.',
    zh: '你拿对照组量过吗？不然很容易自欺欺人。',
  },
  {
    en: 'Counterpoint: worked for us until ~500 customers, then it broke.',
    zh: '反例：这招在我们到约 500 客户前都有效，之后就崩了。',
  },
  {
    en: 'The fix was boring — we just called 20 churned users on the phone.',
    zh: '解法很无聊——我们就是给 20 个流失用户打了电话。',
  },
  {
    en: 'Pricing is downstream of positioning. Fix the latter first.',
    zh: '定价是定位的下游。先把定位修好。',
  },
  {
    en: 'Honestly this smells like a retention problem dressed up as acquisition.',
    zh: '说实话这像是把留存问题打扮成了获客问题。',
  },
  { en: 'Source? Would love to see the actual numbers.', zh: '有数据来源吗？想看看真实数字。' },
  { en: 'Tried this. Lasted two weeks. Reverted.', zh: '试过。撑了两周。回滚了。' },
  {
    en: 'Strong agree. The hard part is doing it consistently for 6 months.',
    zh: '强烈同意。难的是坚持做满 6 个月。',
  },
  { en: 'What stack did you use to instrument this?', zh: '你用什么技术栈埋点的？' },
  {
    en: 'This is survivorship bias — for every win there are 50 silent failures.',
    zh: '这是幸存者偏差——每个成功背后有 50 个沉默的失败。',
  },
  {
    en: 'We saw the opposite: annual plans hid our churn signal completely.',
    zh: '我们看到的正相反：年付把流失信号完全藏住了。',
  },
  {
    en: 'The flat 30c is brutal at low ACV, agreed.',
    zh: '低客单价下那固定 30 美分确实要命，同意。',
  },
  {
    en: 'Curious how this holds once a competitor undercuts you.',
    zh: '好奇等竞品来压价时这套还撑不撑得住。',
  },
  { en: 'Underrated take. Saving this thread.', zh: '被低估的观点。先把这帖存了。' },
  {
    en: 'Did support load actually drop, or did tickets just move channels?',
    zh: '支持负担真降了，还是工单只是换了渠道？',
  },
  {
    en: 'For us the unlock was onboarding, not the feature itself.',
    zh: '对我们来说破局点是引导，而不是功能本身。',
  },
  { en: 'How long was the experiment? Two weeks is noise.', zh: '实验跑了多久？两周都是噪声。' },
  { en: 'Roughly matches what we see in our own data.', zh: '跟我们自己数据里看到的大致吻合。' },
  {
    en: 'Devil is in the segmentation — averages lie here.',
    zh: '魔鬼藏在分群里——这里平均数会骗人。',
  },
];

function genComments(total: number, maxDepth: number, seedNum: number): Comment[] {
  if (total <= 0) return [];
  const rnd = mulberry32(seedNum);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;
  let made = 0;
  const build = (depth: number): Comment => {
    made += 1;
    const tpl = pick(GEN_POOL);
    const node: Comment = {
      author: pick(GEN_AUTHORS),
      score: Math.floor(rnd() * 130),
      depth,
      body: tpl.en,
      bodyZh: tpl.zh,
    };
    if (depth < maxDepth && made < total && rnd() < 0.45) {
      const kids = 1 + Math.floor(rnd() * 2);
      const children: Comment[] = [];
      for (let i = 0; i < kids && made < total; i++) children.push(build(depth + 1));
      node.children = children;
    }
    return node;
  };
  const roots: Comment[] = [];
  while (made < total) roots.push(build(0));
  return roots;
}

const RAW: Post[] = [
  {
    id: 't3_saas01',
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'How do you handle churn when customers "just forget" to use the product?',
    titleZh: '客户「就是忘了用」导致的流失，你们怎么破？',
    body: 'We have decent activation but 6-month churn is brutal. People sign up, use it twice, then ghost. Tried emails, in-app nudges… nothing sticks. What actually moved the needle for you?',
    bodyZh:
      '激活率还行，但 6 个月流失惨不忍睹。用户注册后用两次就消失了。邮件、应用内提醒都试过……没一个管用。你们到底是靠什么扭转的？',
    author: 'indie_maker_jo',
    score: 312,
    numComments: 84,
    commentDepth: 3,
    ageMinutes: 95,
    comments: [
      c(
        'growthq',
        41,
        0,
        'Onboarding that ties the product to a recurring workflow. If it is not in their weekly routine, you lost.',
        '把产品绑进一个周期性工作流的引导。如果它没进用户每周的例行流程，你就输了。',
        [
          c(
            'indie_maker_jo',
            12,
            1,
            'Any concrete example of "tying to a workflow"?',
            '「绑进工作流」有具体例子吗？',
            [
              c(
                'growthq',
                18,
                2,
                'We send a Monday digest they actually need; the digest links back into the app. Usage doubled.',
                '我们每周一推一份用户真正需要的摘要，摘要里带回应用的链接。使用率翻倍。',
              ),
            ],
          ),
        ],
      ),
      c(
        'saas_dan',
        23,
        0,
        'Usage-based pricing changed everything for us — if they forget, they pay less, and they self-select back.',
        '按用量计费彻底改变了我们——用户忘了用就少付钱，他们会自己回来。',
      ),
    ],
  },
  {
    id: 't3_saas02',
    source: 'reddit',
    channel: 'r/startups',
    title: 'Stripe fees are eating 4% of revenue at small ticket sizes — alternatives?',
    titleZh: '小额订单下 Stripe 手续费吃掉 4% 营收——有替代吗？',
    body: 'Average order is $7. Between Stripe + currency conversion we lose ~4%. At our volume that is a real salary. What do micro-SaaS folks use?',
    bodyZh:
      '客单价 $7。Stripe 加货币转换大概损失 4%。按我们的量这是一份实打实的工资。微型 SaaS 都用什么？',
    author: 'tiny_ticket',
    score: 198,
    numComments: 56,
    commentDepth: 2,
    ageMinutes: 220,
    comments: [
      c(
        'payments_nerd',
        30,
        0,
        'At $7 ACV nothing beats Stripe meaningfully; the fixed 30c is your killer, not the %. Bundle into larger purchases.',
        '$7 客单价下没什么能明显胜过 Stripe；要命的是固定的 30 美分，不是百分比。把它打包成更大额的购买。',
        [
          c(
            'tiny_ticket',
            7,
            1,
            'Yeah the 30c flat is the real pain. Considering credit packs.',
            '对，固定 30 美分才是真痛点。在考虑做点数包。',
          ),
        ],
      ),
      c(
        'eu_founder',
        14,
        0,
        'Mollie is cheaper in EU for small tickets, worth a look.',
        '在欧盟小额场景 Mollie 更便宜，值得看看。',
      ),
    ],
  },
  {
    id: 't3_saas03',
    source: 'reddit',
    channel: 'r/Entrepreneur',
    title: 'Cold email is dead for B2B SaaS? My 3-month experiment',
    titleZh: 'B2B SaaS 的冷邮件已死？我三个月的实验',
    body: '',
    bodyZh: '',
    author: 'b2b_ops',
    score: 421,
    numComments: 133,
    commentDepth: 3,
    ageMinutes: 540,
    comments: [
      c(
        'reply_guy',
        55,
        0,
        'Not dead, just saturated. Deliverability is the whole game now — warm domains, tight lists.',
        '没死，只是饱和了。现在比的全是送达率——养好的域名、精准的名单。',
      ),
      c(
        'skeptic7',
        19,
        0,
        'Define dead. We still close 5-figure deals from cold. Your list quality is probably the issue.',
        '怎么算「死」？我们靠冷邮件照样签五位数的单。问题大概出在你的名单质量。',
      ),
    ],
  },
  {
    id: 't3_saas04',
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'Anyone else drowning in support tickets after adding AI features?',
    titleZh: '上了 AI 功能后被工单淹没的不止我一个吧？',
    body: 'Shipped an AI assistant and support volume tripled — users expect magic, get confused, file tickets. Did AI features increase your support load?',
    bodyZh:
      '上线了 AI 助手，工单量翻了三倍——用户期待魔法、结果一脸懵、然后开工单。你们的 AI 功能也推高了支持负担吗？',
    author: 'support_swamped',
    score: 167,
    numComments: 49,
    commentDepth: 2,
    ageMinutes: 75,
    comments: [
      c(
        'cx_lead',
        28,
        0,
        'Yes. AI raises expectations faster than it meets them. We added confidence labels + "this may be wrong" and tickets dropped 30%.',
        '会。AI 抬高预期的速度快过它兑现的速度。我们加了置信度标签 +「此结果可能有误」，工单降了 30%。',
        [
          c(
            'support_swamped',
            9,
            1,
            'Confidence labels — smart. Trying that.',
            '置信度标签——高。我试试。',
          ),
        ],
      ),
    ],
  },
  {
    id: 't3_saas05',
    source: 'reddit',
    channel: 'r/startups',
    title: 'We open-sourced our core and revenue went UP — counterintuitive lessons',
    titleZh: '我们把核心开源了，营收反而涨了——反直觉的教训',
    body: 'Everyone said open-sourcing the engine would kill our paid tier. Six months later MRR is up 40%. Here is what actually happened.',
    bodyZh: '所有人都说把引擎开源会干掉我们的付费档。半年后 MRR 涨了 40%。下面是真实发生的事。',
    author: 'oss_founder',
    score: 503,
    numComments: 91,
    commentDepth: 2,
    ageMinutes: 1290,
    comments: [
      c(
        'hnreader',
        44,
        0,
        'Classic — OSS is distribution, the paid tier is the hosting/ops. Works when self-hosting is genuinely annoying.',
        '经典——开源是分发渠道，付费档卖的是托管/运维。当自托管确实麻烦时就成立。',
      ),
    ],
  },
  {
    id: 't3_saas06',
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'Pricing page A/B test: removing the cheapest tier raised conversions 22%',
    titleZh: '定价页 A/B：砍掉最低档，转化反升 22%',
    body: 'Counterintuitive but real. Dropping our $9 plan pushed people to $29 instead of away. Anchoring is wild.',
    bodyZh: '反直觉但真实。砍掉 $9 套餐把人推向了 $29，而不是推走。锚定效应太猛了。',
    author: 'price_tinkerer',
    score: 276,
    numComments: 63,
    commentDepth: 1,
    ageMinutes: 410,
    comments: [
      c(
        'cro_pat',
        33,
        0,
        'Decoy effect. Now add a "most popular" badge on $29 and watch it climb again.',
        '诱饵效应。现在给 $29 加个「最受欢迎」标，看它再涨一波。',
      ),
    ],
  },
  // ── 以下默认作「待发现」池：discover 会陆续发现它们 ──
  {
    id: 't3_saas07',
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'Building in public got us 0 customers but 10k followers — what went wrong?',
    titleZh: '公开构建给我们带来 0 客户却 1 万粉丝——哪儿错了？',
    body: 'Huge audience, no revenue. Followers love the journey but will not pay for the product. Anyone bridged this gap?',
    bodyZh: '受众巨大，收入为零。粉丝喜欢这段旅程，但不会为产品付钱。有人跨过这道坎吗？',
    author: 'public_builder',
    score: 144,
    numComments: 38,
    commentDepth: 2,
    ageMinutes: 30,
    comments: [
      c(
        'audience_skeptic',
        22,
        0,
        'Followers of "building in public" want to BE you, not buy from you. Wrong audience for the product.',
        '「公开构建」的粉丝想成为你，而不是向你买东西。对产品来说是错的受众。',
      ),
    ],
  },
  {
    id: 't3_saas08',
    source: 'reddit',
    channel: 'r/startups',
    title: 'Our biggest customer churned and took 30% of MRR — concentration risk is real',
    titleZh: '最大客户流失带走 30% MRR——集中度风险是真的',
    body: 'One logo was 30% of revenue. They got acquired, killed our contract. Lesson learned the hard way. How do you de-risk?',
    bodyZh: '一个客户占了 30% 营收。他们被收购后砍了我们的合同。血的教训。你们怎么去风险化？',
    author: 'mrr_anxiety',
    score: 389,
    numComments: 77,
    commentDepth: 2,
    ageMinutes: 18,
    comments: [
      c(
        'cfo_minded',
        40,
        0,
        'No customer over 10% of MRR is the rule. Painful early, lifesaving later.',
        '单客户不超过 MRR 的 10%，这是铁律。早期难受，后期救命。',
      ),
    ],
  },
  {
    id: 't3_saas09',
    source: 'reddit',
    channel: 'r/Entrepreneur',
    title: 'Free tier abusers are costing us more than they convert — kill it?',
    titleZh: '免费档的薅羊毛党成本高过转化——砍掉它？',
    body: 'Our free tier is 90% of infra cost and 2% of conversions. Tempted to nuke it. Talk me out of it.',
    bodyZh: '免费档占了 90% 的基础设施成本、2% 的转化。很想直接砍。来劝劝我别砍。',
    author: 'infra_bleeding',
    score: 231,
    numComments: 58,
    commentDepth: 1,
    ageMinutes: 8,
    comments: [
      c(
        'plg_vet',
        27,
        0,
        'Do not kill it, gate it. Cap the expensive operation, keep the cheap value. Free tier is your funnel.',
        '别砍，设闸。把昂贵的操作设上限，留住廉价的价值。免费档是你的漏斗。',
      ),
    ],
  },
  {
    id: 'hn_42010',
    source: 'hackernews',
    channel: 'front',
    title: 'Show HN: I built a tool that turns Postgres into a realtime API in one command',
    titleZh: 'Show HN：我做了个工具，一条命令把 Postgres 变成实时 API',
    body: '',
    bodyZh: '',
    author: 'pg_hacker',
    score: 612,
    numComments: 204,
    commentDepth: 3,
    ageMinutes: 50,
    comments: [
      c(
        'dbweenie',
        88,
        0,
        'How does this handle row-level security? That is where every "instant API" tool falls over.',
        '它怎么处理行级安全（RLS）？所有「即时 API」工具都栽在这上面。',
        [
          c(
            'pg_hacker',
            31,
            1,
            'RLS is passed through; we generate policies from your existing roles. Demo in the README.',
            'RLS 直接透传；我们根据你已有的角色生成策略。README 里有演示。',
          ),
        ],
      ),
    ],
  },
  {
    id: 'hn_42011',
    source: 'hackernews',
    channel: 'new',
    title: 'Ask HN: Why is every dev tool now a "platform"? I just want a CLI',
    titleZh: 'Ask HN：为什么现在每个开发工具都成了「平台」？我只想要个 CLI',
    body: 'Feels like every tool wants to be an ecosystem with a dashboard and a billing portal. Whatever happened to a sharp single-purpose CLI?',
    bodyZh: '感觉每个工具都想做成带仪表盘和计费门户的生态。那种锋利的、单一用途的 CLI 哪儿去了？',
    author: 'unix_greybeard',
    score: 287,
    numComments: 159,
    commentDepth: 2,
    ageMinutes: 12,
    comments: [
      c(
        'vc_logic',
        45,
        0,
        'Because CLIs do not have expansion revenue. Platforms do. Follow the money.',
        '因为 CLI 没有扩张性营收，平台有。跟着钱走就懂了。',
      ),
    ],
  },
  {
    id: 'rss_tc_88',
    source: 'rss',
    channel: 'TechCrunch',
    title: 'Vertical SaaS is quietly out-earning horizontal SaaS, new data shows',
    titleZh: '新数据显示：垂直 SaaS 正悄悄跑赢横向 SaaS',
    body: 'A fresh report finds niche, industry-specific SaaS retains customers far longer than broad horizontal tools — and commands higher pricing.',
    bodyZh: '一份最新报告发现：聚焦细分行业的 SaaS 留存远高于宽泛的横向工具——而且定价更高。',
    author: 'TechCrunch',
    score: 0,
    numComments: 0,
    commentDepth: 0,
    ageMinutes: 140,
    comments: [],
  },
];

/**
 * 最终语料：每帖在手写特写评论基础上，按目标条数补量到「有多有少」（25 ~ 90，且不超过 numComments）。
 * rss 等 numComments=0 的帖不补；补出的评论同样带中文译文。
 */
/**
 * 给评论树逐节点派生「年龄」（分钟）：确定性（按帖 id 播种）、比帖子新、回复比父评论更新。
 * 评论缺乏真实时间戳，故在此一次性补；随模拟时钟推进，显示的「X 前」会一起变老（同帖子）。
 */
function withCommentTimes(post: Post): Post {
  const rnd = mulberry32(hashStr(post.id) ^ 0x9e3779b9);
  const walk = (nodes: Comment[], maxAge: number): Comment[] =>
    nodes.map((n) => {
      const ageMinutes = Math.max(1, Math.round(maxAge * (0.1 + rnd() * 0.85)));
      return { ...n, ageMinutes, children: n.children ? walk(n.children, ageMinutes) : undefined };
    });
  return { ...post, comments: walk(post.comments, post.ageMinutes) };
}

export const POSTS: Post[] = RAW.map((p) => {
  const have = countComments(p.comments);
  const target = Math.min(p.numComments, 25 + (hashStr(p.id) % 65));
  const extra = Math.max(0, target - have);
  const filled =
    extra > 0
      ? { ...p, comments: [...p.comments, ...genComments(extra, 2, hashStr(p.id) + 7)] }
      : p;
  return withCommentTimes(filled);
});
