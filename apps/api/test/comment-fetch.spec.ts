import { describe, expect, it } from 'vitest';
import { buildContext } from '@hatch-radar/analysis';
import { collectHnComments, flattenRedditTree } from '@hatch-radar/crawler';
import type { CommentRow, PostRow } from '@hatch-radar/shared';

/**
 * 评论抓取完整性 + 分析上下文组装的纯逻辑单测（无网络、无 DB）。
 * 覆盖三处此前会静默丢评论的环节：
 *  1. Reddit 拍平——深层下钻、more 折叠计入 dropped、deleted 剔除
 *  2. HN 递归 BFS——多层捕获、总量/深度上限触发 dropped、无截断时 dropped=0
 *  3. buildContext——渲染完整楼层树（深层评论可见）+ 不完整口径标注
 */

// ---- Reddit listing child 构造助手 ----
type Child = { kind: string; data: Record<string, unknown> };
const t1 = (id: string, body: string, score: number, replies?: Child[]): Child => ({
  kind: 't1',
  data: {
    id,
    body,
    author: `u_${id}`,
    score,
    created_utc: 1000,
    replies: replies ? { data: { children: replies } } : '',
  },
});
const more = (count: number): Child => ({ kind: 'more', data: { count, children: [] } });

describe('flattenRedditTree（Reddit 评论拍平）', () => {
  it('完整下钻 >2 层、父子串联正确、深度逐层递增', () => {
    const children = [
      t1('a', 'A', 10, [t1('a1', 'A1', 5, [t1('a1x', 'A1X', 2, [t1('a1x9', 'A1X9', 1)])])]),
    ];
    const { comments } = flattenRedditTree(children);
    expect(comments.map((c) => c.id)).toEqual(['a', 'a1', 'a1x', 'a1x9']);
    expect(comments.map((c) => c.depth)).toEqual([0, 1, 2, 3]);
    expect(comments.map((c) => c.parentId)).toEqual([null, 'a', 'a1', 'a1x']);
  });

  it('more 折叠节点的 count 累加进 dropped（不展开 morechildren）', () => {
    const children = [t1('a', 'A', 10, [t1('a1', 'A1', 5), more(7)]), more(3)];
    const { comments, dropped } = flattenRedditTree(children);
    expect(comments.map((c) => c.id)).toEqual(['a', 'a1']); // more 自身不入列
    expect(dropped).toBe(10); // 7（楼内折叠）+ 3（顶层折叠）
  });

  it('[deleted]/[removed] 评论被剔除，且不计入 dropped', () => {
    const children = [t1('a', '[deleted]', 0), t1('b', '[removed]', 0), t1('c', '正常', 1)];
    const { comments, dropped } = flattenRedditTree(children);
    expect(comments.map((c) => c.id)).toEqual(['c']);
    expect(dropped).toBe(0);
  });
});

// ---- HN 内存树构造助手 ----
type FakeItem = {
  id: number;
  type: string;
  by?: string;
  text?: string;
  time?: number;
  kids?: number[];
};
function fakeFetcher(tree: Record<number, FakeItem>) {
  return async (ids: number[]) =>
    ids.map((id) => tree[id]).filter((x): x is FakeItem => Boolean(x));
}
// 链：1→[2,3]，2→[4]，4→[5]（c1 d0；c2/c3 d1；c4 d2；c5 d3），共 5 条
const HN_TREE: Record<number, FakeItem> = {
  1: { id: 1, type: 'comment', by: 'u1', text: 'c1', time: 1, kids: [2, 3] },
  2: { id: 2, type: 'comment', by: 'u2', text: 'c2', time: 1, kids: [4] },
  3: { id: 3, type: 'comment', by: 'u3', text: 'c3', time: 1 },
  4: { id: 4, type: 'comment', by: 'u4', text: 'c4', time: 1, kids: [5] },
  5: { id: 5, type: 'comment', by: 'u5', text: 'c5', time: 1 },
};

describe('collectHnComments（HN 递归 BFS 抓取）', () => {
  it('递归抓全多层、深度/父子正确，未截断时 dropped=0', async () => {
    const { comments, dropped } = await collectHnComments(
      { kids: [1], descendants: 5 },
      fakeFetcher(HN_TREE),
    );
    expect(comments.map((c) => c.id)).toEqual(['hn_1', 'hn_2', 'hn_3', 'hn_4', 'hn_5']);
    expect(comments.map((c) => c.depth)).toEqual([0, 1, 1, 2, 3]); // 深度 > 1，旧实现拿不到
    expect(comments.find((c) => c.id === 'hn_5')!.parentId).toBe('hn_4');
    expect(dropped).toBe(0);
  });

  it('descendants 大于已抓但未触上限时 dropped 仍为 0（差值仅为源端已删，非我们丢弃）', async () => {
    const { dropped } = await collectHnComments(
      { kids: [1], descendants: 99 }, // 标称 99，实际只抓到 5
      fakeFetcher(HN_TREE),
    );
    expect(dropped).toBe(0);
  });

  it('总量上限触发截断：dropped = descendants − 已抓', async () => {
    const { comments, dropped } = await collectHnComments(
      { kids: [1], descendants: 5 },
      fakeFetcher(HN_TREE),
      { maxComments: 2 },
    );
    expect(comments).toHaveLength(2);
    expect(dropped).toBe(3);
  });

  it('深度上限截断更深层级', async () => {
    const { comments, dropped } = await collectHnComments(
      { kids: [1], descendants: 5 },
      fakeFetcher(HN_TREE),
      { maxDepth: 1 },
    );
    expect(comments.map((c) => c.id)).toEqual(['hn_1', 'hn_2', 'hn_3']); // 仅 depth 0/1
    expect(dropped).toBe(2);
  });
});

// ---- buildContext ----
function mkPost(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'p1',
    source: 'hackernews',
    subreddit: 'hackernews_top',
    title: '帖子标题',
    author: 'op',
    selftext: '',
    url: null,
    permalink: 'https://news.ycombinator.com/item?id=1',
    score: 100,
    num_comments: 4,
    created_utc: 1_700_000_000,
    fetched_at: 1_700_000_000,
    comment_pass: 2,
    comments_fetched_at: 1_700_000_000,
    comments_changed_at: null,
    export_locked_at: null,
    analyzed_at: null,
    analyze_attempts: 0,
    title_hash: null,
    selftext_hash: null,
    recheck_misses: 0,
    recheck_due_sweep: 0,
    last_rechecked_at: null,
    ...overrides,
  };
}
function cm(
  id: string,
  parent_id: string | null,
  depth: number,
  score: number,
  body: string,
): CommentRow {
  return {
    id,
    post_id: 'p1',
    parent_id,
    author: `u_${id}`,
    body,
    score,
    depth,
    created_utc: 1,
    fetched_at: 1,
    body_hash: null,
  };
}

describe('buildContext（分析上下文组装）', () => {
  it('渲染完整楼层树：深层评论（depth≥2）对模型可见且带缩进', () => {
    const comments = [
      cm('a', null, 0, 10, '顶层评论'),
      cm('a1', 'a', 1, 5, '一级回复'),
      cm('a1x', 'a1', 2, 2, '深层回复内容'),
    ];
    const out = buildContext(mkPost({ num_comments: 3 }), comments);
    // 旧实现只渲染 depth0 + 直接回复，depth2 会缺失——这里必须出现
    expect(out).toContain('深层回复内容');
    expect(out).toMatch(/ {8}↳ .*深层回复内容/); // depth2 → 8 空格缩进
    expect(out).toContain('本地已抓 3 条');
  });

  it('来源标称多于本地已抓时标注「可能不完整」并给出口径', () => {
    const comments = [cm('a', null, 0, 10, '唯一评论')];
    const out = buildContext(mkPost({ num_comments: 50 }), comments);
    expect(out).toContain('来源标称 50 条');
    expect(out).toContain('本地已抓 1 条');
    expect(out).toContain('可能不完整');
  });

  it('展示数受预算约束时，提示「另有 N 条未展示」', () => {
    // 30 条顶层评论 > MAX_TOP_THREADS(25)，渲染会被截断
    const comments = Array.from({ length: 30 }, (_, i) => cm(`c${i}`, null, 0, 30 - i, `评论${i}`));
    const out = buildContext(mkPost({ num_comments: 30 }), comments);
    expect(out).toMatch(/另有 5 条已抓评论受上下文长度上限未展示/);
  });

  it('无评论时输出占位', () => {
    expect(buildContext(mkPost({ num_comments: 0 }), [])).toContain('（暂无评论）');
  });
});
