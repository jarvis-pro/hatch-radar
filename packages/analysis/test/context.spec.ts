import type { CommentRow, PostRow } from '@hatch-radar/shared';
import { describe, expect, it } from 'vitest';

import { buildContext, decodeHtmlEntities } from '@/analyzer/context';

/**
 * context 的 HTML 实体解码：送 AI 前对**已落库文本**的一层防御性再解码。
 * 回归本次修复：旧实现只 .replace 少数固定实体，残留十进制 `&#NN;` 与其他十六进制 `&#xHH;` 未解
 * （与 crawler `decodeEntities` 同源的不完整 bug，参见 crawler/test/hackernews.spec.ts）。
 */
describe('decodeHtmlEntities（送 AI 前的防御性实体解码）', () => {
  it('解码十六进制实体 &#x2F; → /（本次修复的核心 case）', () => {
    expect(decodeHtmlEntities('https:&#x2F;&#x2F;arstechnica.com&#x2F;ai&#x2F;x')).toBe(
      'https://arstechnica.com/ai/x',
    );
  });

  it("解码十六进制撇号 &#x27; → '（x 大小写均可）", () => {
    expect(decodeHtmlEntities('it&#x27;s')).toBe("it's");
    expect(decodeHtmlEntities('it&#X27;s')).toBe("it's");
  });

  it("解码十进制数字实体：&#39; → ' / &#47; → /（旧实现完全漏掉）", () => {
    expect(decodeHtmlEntities('it&#39;s a&#47;b')).toBe("it's a/b");
  });

  it('解码常见命名实体 &amp; &lt; &gt; &quot;', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;x&gt; &quot;q&quot;')).toBe('a & b <x> "q"');
  });

  it('双重编码 &amp;#x2F; 仅解一层 → &#x2F;（不过度解码成 /）', () => {
    expect(decodeHtmlEntities('path &amp;#x2F; here')).toBe('path &#x2F; here');
    expect(decodeHtmlEntities('a &amp;amp; b')).toBe('a &amp; b');
  });

  it('未识别命名实体 / 非法码点 / 残缺实体一律原样保留', () => {
    expect(decodeHtmlEntities('&unknownentity; &#xZZ; &#; &amp')).toBe(
      '&unknownentity; &#xZZ; &#; &amp',
    );
  });

  it('幂等：对已解码文本再跑一次不变（回填可重复执行）', () => {
    const clean = decodeHtmlEntities('https:&#x2F;&#x2F;x.com&#x2F;a it&#x27;s & ok');
    expect(decodeHtmlEntities(clean)).toBe(clean);
  });

  it('只碰实体、不碰标签：正文里字面 <...> 原样保留（作用于已入库文本，绝不删标签）', () => {
    expect(decodeHtmlEntities('use <b> for &amp; bold')).toBe('use <b> for & bold');
  });
});

const basePost = (overrides: Partial<PostRow>): PostRow => ({
  id: 'rd_1',
  source: 'reddit',
  subreddit: 'test',
  title: 'T',
  author: 'alice',
  selftext: '',
  url: null,
  permalink: null,
  score: 1,
  num_comments: 0,
  created_utc: 1_700_000_000,
  fetched_at: 1_700_000_000,
  comment_pass: 0,
  comments_fetched_at: null,
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
});

const baseComment = (overrides: Partial<CommentRow>): CommentRow => ({
  id: 'c1',
  post_id: 'rd_1',
  parent_id: null,
  author: 'bob',
  body: '',
  score: 0,
  depth: 0,
  created_utc: 1_700_000_100,
  fetched_at: 1_700_000_100,
  body_hash: null,
  ...overrides,
});

/**
 * 确认解码确实接入了 buildContext 的两条文本入口（正文 selftext + 每条评论 body，
 * 均经 normalizeBody → decodeHtmlEntities），而非只是个游离纯函数。
 */
describe('buildContext 把实体解码接到正文与评论体', () => {
  it('正文(selftext)中的十六进制 / 十进制残留实体被解码', () => {
    const ctx = buildContext(
      basePost({ selftext: 'see https:&#x2F;&#x2F;a.com it&#39;s nice' }),
      [],
    );
    expect(ctx).toContain("see https://a.com it's nice");
    expect(ctx).not.toContain('&#x2F;');
    expect(ctx).not.toContain('&#39;');
  });

  it('评论体中的残留实体被解码', () => {
    const ctx = buildContext({ ...basePost({ num_comments: 1 }) }, [
      baseComment({ body: 'a&#x2F;b &amp; c' }),
    ]);
    expect(ctx).toContain('a/b & c');
    expect(ctx).not.toContain('&#x2F;');
  });
});
