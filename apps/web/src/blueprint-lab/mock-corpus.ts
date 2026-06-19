/**
 * 帖子语料库（原型 mock）：给运行任务挂载真实感内容——长短不一的标题/正文、深浅不一的评论树、
 * Reddit/HackerNews/RSS 各来源各指标。内容用英文（贴合真实抓取的英文社区），UI 文案仍中文。
 *
 * `buildRunTasks`（[mock.ts](./mock)）按种子确定式给每个任务分配一条帖子，环节产物据此派生真实数字。
 */
import type { MockComment, MockPost } from './types';

/** 评论构造器（depth 在 assignDepth 里按层级回填）。 */
function c(author: string, score: number, body: string, children: MockComment[] = []): MockComment {
  return { author, score, body, depth: 0, children };
}

/** 递归回填评论深度。 */
function assignDepth(nodes: MockComment[], d: number): void {
  for (const n of nodes) {
    n.depth = d;
    if (n.children && n.children.length) assignDepth(n.children, d + 1);
  }
}

/** 帖子语料（14 条，覆盖各内容形态）。 */
export const POSTS: MockPost[] = [
  {
    id: 't3_1a9f2k',
    source: 'reddit',
    channel: 'r/SaaS',
    title:
      'I spent 18 months building a project management SaaS and made $0 — here is everything I did wrong',
    body: 'Started in early 2024, quit my job, burned through $40k of savings. Built every feature anyone asked for, never charged a cent until month 14. Turns out "everyone" is not a customer. By the time I added billing I had 3 paying users and a churn rate that made it pointless. Posting the full post-mortem because I wish someone had told me this two years ago: talk to customers before you write a single line of code, and charge from day one.',
    author: 'burned_out_founder',
    score: 1247,
    numComments: 384,
    commentDepth: 7,
    ageMinutes: 182,
    comments: [
      c(
        'saas_greybeard',
        412,
        'Charging from day one is the single highest-leverage lesson here. Free users give you feedback optimized for free products.',
        [
          c(
            'burned_out_founder',
            88,
            'Painfully accurate. Every "must-have" request came from people who would never pay.',
            [
              c(
                'pmtool_dan',
                51,
                'This is why I gate the loudest feature requests behind a paid tier now. Filters the noise instantly.',
                [
                  c(
                    'saas_greybeard',
                    33,
                    'Exactly. Willingness to pay is the only feedback that survives contact with a roadmap.',
                    [
                      c('lurker_99', 12, 'Stealing "survives contact with a roadmap".', [
                        c('pmtool_dan', 7, 'It is a Clausewitz reference, steal away.'),
                      ]),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      c(
        'contrarian_vc',
        96,
        'Counterpoint: some categories genuinely need a free tier to seed a network. PM tools are not one of them though.',
        [
          c(
            'indie_maya',
            24,
            'Right, free works for collaboration-driven virality, not for internal tools nobody shares.',
          ),
        ],
      ),
      c('throwaway_2231', 5, 'How did you survive 14 months with no revenue? Genuinely asking.', [
        c('burned_out_founder', 19, 'Savings + denial, in that order.'),
      ]),
    ],
  },
  {
    id: 't3_2b3c1m',
    source: 'reddit',
    channel: 'r/startups',
    title: 'Cofounder wants to quit',
    body: 'Two months in and he has already checked out. Equity is split 50/50 and vesting just started. What do I do?',
    author: 'anxious_ceo',
    score: 53,
    numComments: 11,
    commentDepth: 2,
    ageMinutes: 41,
    comments: [
      c(
        'legal_eagle_jd',
        34,
        'A one-year cliff exists precisely for this. If he leaves before it, he keeps nothing. Check your vesting docs today.',
        [c('anxious_ceo', 8, 'We have a 1-year cliff. That is a relief, thank you.')],
      ),
      c(
        'serial_founder_x',
        17,
        'Have the direct conversation. Checked-out at month two rarely recovers. Better to find out now than at month ten.',
      ),
    ],
  },
  {
    id: 't3_3d8h7p',
    source: 'hackernews',
    channel: 'front',
    title: 'Show HN: I built an open-source alternative to Zapier',
    body: '',
    author: 'tomhowardx',
    score: 642,
    numComments: 213,
    commentDepth: 6,
    ageMinutes: 96,
    comments: [
      c(
        'skeptical_eng',
        188,
        'How is this different from n8n, which is also open-source and has a much larger ecosystem already?',
        [
          c(
            'tomhowardx',
            142,
            'Fair question. n8n is node-based and visual-first; mine is code-first with a typed SDK. Different audience.',
            [
              c(
                'skeptical_eng',
                71,
                'Code-first is a real gap, actually. The visual builders fall apart past ~20 nodes.',
                [
                  c(
                    'automation_nerd',
                    44,
                    'Hard agree. I have a 60-node n8n flow that is impossible to debug.',
                    [
                      c(
                        'tomhowardx',
                        38,
                        'That exact pain is why I started this. Version control + diffs on your automations.',
                        [c('skeptical_eng', 22, 'Okay, that sold me. Starring it.')],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      c(
        'licensing_hawk',
        57,
        'What is the license? "open-source" in a Show HN title has burned me before (looking at you, BSL).',
        [c('tomhowardx', 49, 'Apache 2.0, no CLA, no rug-pull clause. Promise.')],
      ),
      c('selfhost_sam', 13, 'Docker compose in the repo? That is the only onboarding I trust.'),
    ],
  },
  {
    id: 't3_4e2j9q',
    source: 'reddit',
    channel: 'r/Entrepreneur',
    title: 'How do you validate a B2B idea when you cannot reach the decision makers?',
    body: 'Selling to hospital procurement. Cannot get a single call booked. Cold email bounces, LinkedIn ignored. Is there a playbook for gatekept industries?',
    author: 'healthtech_hopeful',
    score: 211,
    numComments: 47,
    commentDepth: 4,
    ageMinutes: 320,
    comments: [
      c(
        'b2b_closer',
        73,
        'Stop trying to reach the decision maker. Find the person whose job you make easier and let them champion you internally.',
        [
          c('healthtech_hopeful', 21, 'So target the nurse/admin, not the procurement VP?', [
            c(
              'b2b_closer',
              40,
              'Exactly. Bottom-up beats top-down in gatekept orgs nine times out of ten.',
              [
                c(
                  'exhospital_it',
                  18,
                  'Can confirm from the inside. Procurement only signs what the floor already wants.',
                ),
              ],
            ),
          ]),
        ],
      ),
      c(
        'conference_hustler',
        29,
        'Go to the industry conferences. One hallway conversation beats 500 cold emails in healthcare.',
      ),
    ],
  },
  {
    id: 't3_5f1k4r',
    source: 'rss',
    channel: 'TechCrunch',
    title: 'OpenAI reportedly in talks to raise new round at a valuation north of $300B',
    body: 'According to people familiar with the matter, the round would nearly double the company’s valuation from its last raise, underscoring continued investor appetite for frontier AI despite mounting questions about unit economics and compute costs.',
    author: 'techcrunch',
    score: 0,
    numComments: 0,
    commentDepth: 0,
    ageMinutes: 64,
    comments: [],
  },
  {
    id: 't3_6g7m2s',
    source: 'reddit',
    channel: 'r/webdev',
    title: 'Stop using barrel files',
    body: 'Every index.ts that just re-exports everything is quietly destroying your build times and tree-shaking. We removed ~200 barrel files from our monorepo and cold builds dropped from 90s to 31s. Bundlers cannot tree-shake what a barrel forces them to evaluate. If you must, at least keep them leaf-level and never import a barrel from another barrel.',
    author: 'perf_pedant',
    score: 489,
    numComments: 73,
    commentDepth: 3,
    ageMinutes: 540,
    comments: [
      c(
        'dx_advocate',
        61,
        'Counterpoint: the DX of clean imports is worth a few seconds for most teams. Measure before you cargo-cult this.',
        [
          c(
            'perf_pedant',
            44,
            'A few seconds, sure. We were at 90s. There is a threshold where DX becomes "build is running, go get coffee".',
          ),
        ],
      ),
      c(
        'ts_wizard',
        38,
        'The real fix is "isolatedDeclarations" + project references, not banning a pattern wholesale.',
      ),
      c('junior_dev_99', 9, 'TIL what a barrel file even is. Off to delete some.'),
    ],
  },
  {
    id: 't3_7h3n8t',
    source: 'hackernews',
    channel: 'new',
    title: 'Ask HN: What is your tech stack for a solo SaaS in 2026?',
    body: '',
    author: 'solo_curious',
    score: 88,
    numComments: 19,
    commentDepth: 2,
    ageMinutes: 28,
    comments: [
      c(
        'boring_tech_fan',
        41,
        'Postgres, a monolith, server-rendered HTML, and a credit card on file at one cloud provider. Boring scales.',
        [
          c('solo_curious', 12, 'No SPA at all?', [
            c(
              'boring_tech_fan',
              27,
              'Sprinkle interactivity where needed. You are one person; a 12-package frontend is a liability, not an asset.',
            ),
          ]),
        ],
      ),
      c(
        'edge_maximalist',
        8,
        'Edge functions + a managed Postgres and you never think about servers again.',
      ),
    ],
  },
  {
    id: 't3_8j5p1u',
    source: 'reddit',
    channel: 'r/SaaS',
    title: 'Stripe just changed their pricing again',
    body: '',
    author: 'billing_watcher',
    score: 327,
    numComments: 156,
    commentDepth: 8,
    ageMinutes: 210,
    comments: [
      c(
        'margins_matter',
        144,
        'At our volume the new tiers add ~$2k/mo. Not enough to switch, exactly enough to be annoying. Classic Stripe.',
        [
          c(
            'payments_pro',
            90,
            'That "annoying but not switchable" band is the entire pricing strategy. They have studied your switching cost.',
            [
              c(
                'margins_matter',
                61,
                'The switching cost is the moat. Re-integrating a payments provider is a quarter of eng time nobody has.',
                [
                  c(
                    'ex_stripe',
                    48,
                    'Used to work there. The pricing band is deliberately set just under the migration-pain threshold.',
                    [
                      c(
                        'payments_pro',
                        31,
                        'Wild to see it confirmed. Everyone suspected, nobody had receipts.',
                        [
                          c(
                            'skeptic_tom',
                            19,
                            'Source: "trust me bro, ex-stripe". But it tracks.',
                            [c('ex_stripe', 14, 'Fair. Believe the incentives, not me.')],
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      c(
        'adyen_curious',
        22,
        'Anyone actually migrated to Adyen/Braintree and lived to tell? Quotes always look better than reality.',
      ),
    ],
  },
  {
    id: 't3_9k6q3v',
    source: 'reddit',
    channel: 'r/startups',
    title:
      'VCs told me my TAM was too small. Three years later we are at $4M ARR in that "small" market',
    body: 'Pitched 40 funds in 2023. The most common no was "the market is too niche". The niche was specialty veterinary practice management. Turns out 28,000 clinics each paying $150/mo is a perfectly fine business, and none of the horizontal players cared enough to build for us. We bootstrapped, stayed default-alive, and now the same funds are in my inbox. Lesson: a "small" market with no good software is a gift, not a red flag. Niche down until it hurts, then go one level deeper.',
    author: 'vet_software_ceo',
    score: 904,
    numComments: 121,
    commentDepth: 5,
    ageMinutes: 1440,
    comments: [
      c(
        'niche_believer',
        203,
        '"Niche down until it hurts, then go one level deeper" belongs on a poster. Vertical SaaS is criminally underrated.',
        [
          c(
            'vet_software_ceo',
            77,
            'The whole moat is that big players find your market boring. Boredom is a defensible position.',
            [
              c(
                'horizontal_skeptic',
                45,
                'Until a horizontal player notices $4M ARR and bolts on your feature in a sprint.',
                [
                  c(
                    'vet_software_ceo',
                    68,
                    'Let them. Veterinary compliance workflows are 3 years of domain knowledge they will not copy from a Jira ticket.',
                    [
                      c(
                        'niche_believer',
                        29,
                        'Domain depth as a moat is the most underrated answer to "what stops Google".',
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      c(
        'bootstrapper_jane',
        34,
        'Default-alive is the only fundraising leverage that actually works. Congrats.',
      ),
    ],
  },
  {
    id: 't3_0m8r5w',
    source: 'rss',
    channel: 'Hacker Newsletter',
    title: 'Weekly digest: 12 launches you probably missed this week',
    body: 'This week’s roundup covers a self-hostable analytics tool, two AI coding agents, a Postgres GUI rewrite, and a surprisingly good open-source Calendly clone.',
    author: 'hackernewsletter',
    score: 0,
    numComments: 0,
    commentDepth: 0,
    ageMinutes: 2880,
    comments: [],
  },
  {
    id: 't3_1n9s6x',
    source: 'reddit',
    channel: 'r/indiehackers',
    title: 'First $100 MRR',
    body: 'Took 7 months and a lot of doubt but a stranger on the internet pays me money every month now. Small number, huge feeling.',
    author: 'tiny_wins',
    score: 178,
    numComments: 23,
    commentDepth: 2,
    ageMinutes: 75,
    comments: [
      c(
        'been_there_42',
        56,
        'The jump from $0 to $100 is psychologically bigger than $100 to $10k. You proved someone will pay. Everything after is volume.',
        [c('tiny_wins', 14, 'Needed to hear this today, thank you.')],
      ),
      c('grumpy_oldtimer', 8, 'Congrats, genuinely. Now do it 99 more times.'),
    ],
  },
  {
    id: 't3_2p1t7y',
    source: 'hackernews',
    channel: 'front',
    title: 'Ask HN: How do you handle on-call burnout on a small team?',
    body: 'We are 4 engineers covering a 24/7 product. Rotation is brutal and two people are close to quitting. What actually worked for you, beyond "hire more people" which we cannot afford right now?',
    author: 'tired_techlead',
    score: 297,
    numComments: 88,
    commentDepth: 4,
    ageMinutes: 430,
    comments: [
      c(
        'sre_veteran',
        121,
        'Ruthlessly kill the pages that are not actionable. Most on-call pain is alert noise, not real incidents. Audit a month of pages and delete half.',
        [
          c('tired_techlead', 38, 'How do you decide what is "not actionable"?', [
            c(
              'sre_veteran',
              64,
              'If the runbook is "wait and see" or "it self-resolved", it is a dashboard, not a page. Demote it.',
              [
                c(
                  'ops_minimalist',
                  27,
                  'This. Page = human must act now. Everything else is a Slack message at 9am.',
                ),
              ],
            ),
          ]),
        ],
      ),
      c(
        'comp_realist',
        43,
        'Pay for on-call. Even a small per-shift stipend changes the whole dynamic from "punishment" to "compensated work".',
      ),
    ],
  },
  {
    id: 't3_3q2u8z',
    source: 'reddit',
    channel: 'r/SaaS',
    title:
      'Is it just me or has every "AI-powered" tool become the exact same thin wrapper around GPT with a different landing page gradient and a $49/mo price tag nobody asked for',
    body: '',
    author: 'wrapper_fatigue',
    score: 142,
    numComments: 7,
    commentDepth: 2,
    ageMinutes: 19,
    comments: [
      c(
        'realist_dev',
        51,
        'The wrapper is fine. The problem is wrappers with no proprietary data, no workflow lock-in, and no reason to exist after the next model update.',
        [c('wrapper_fatigue', 13, 'Right, the moat has to be everything except the model.')],
      ),
      c('cynic_supreme', 9, 'See you all at the $49/mo graveyard in 18 months.'),
    ],
  },
  {
    id: 't3_4r3v9a',
    source: 'hackernews',
    channel: 'front',
    title: 'The web is fast enough',
    body: '',
    author: 'minimal_web',
    score: 1583,
    numComments: 487,
    commentDepth: 9,
    ageMinutes: 150,
    comments: [
      c(
        'framework_skeptic',
        392,
        'The web is fast. Our websites are slow. A 4MB JS bundle to render a blog post is a choice, not a constraint.',
        [
          c(
            'react_defender',
            211,
            'Frameworks are not the problem, undisciplined usage is. You can ship a fast React app; most teams just do not.',
            [
              c(
                'framework_skeptic',
                178,
                'At some point "you are holding it wrong" stops being a defense and starts being an indictment of the defaults.',
                [
                  c(
                    'perf_engineer',
                    134,
                    'The defaults are the product. If the easy path is slow, the ecosystem is slow.',
                    [
                      c(
                        'react_defender',
                        87,
                        'Server components are explicitly the new default and they ship far less JS.',
                        [
                          c(
                            'framework_skeptic',
                            62,
                            'Three years and a rewrite to get back to what server-rendered HTML did in 2005.',
                            [
                              c(
                                'greybeard_dev',
                                51,
                                'I have watched this cycle four times now. We reinvent the server, call it new, and act surprised it is fast.',
                                [
                                  c(
                                    'young_gun',
                                    24,
                                    'Okay boomer, but also... you are right and that is annoying.',
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      c(
        'mobile_first',
        73,
        'None of this matters until you test on a $80 Android phone on 3G. Then everyone suddenly cares about bundle size.',
      ),
    ],
  },
];

for (const p of POSTS) assignDepth(p.comments, 0);
