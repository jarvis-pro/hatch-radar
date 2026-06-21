import { describe, expect, it } from 'vitest';
import { decodeEntities, decodeHtml } from '@/lib/crawler/hackernews';

/**
 * HN 富文本 → 纯文本解码：HTML 实体（命名 / 十进制 / 十六进制）+ 标签结构化处理。
 * 回归本次修复：HN Firebase API 返回 HTML 转义文本，旧实现只解少数几个命名实体，
 * 残留 `&#x2F;`（斜杠）等十六进制 / 数字实体未解。
 */
describe('decodeEntities（HTML 实体解码）', () => {
  it('解码十六进制实体 &#x2F; → /（本次修复的核心 case）', () => {
    expect(decodeEntities('https:&#x2F;&#x2F;arstechnica.com&#x2F;ai&#x2F;x')).toBe(
      'https://arstechnica.com/ai/x',
    );
  });

  it("解码十六进制撇号 &#x27; → '（x 大小写均可）", () => {
    expect(decodeEntities('it&#x27;s')).toBe("it's");
    expect(decodeEntities('it&#X27;s')).toBe("it's");
  });

  it("解码十进制数字实体：&#39; → ' / &#47; → /", () => {
    expect(decodeEntities('it&#39;s a&#47;b')).toBe("it's a/b");
  });

  it('解码常见命名实体 &amp; &lt; &gt; &quot;', () => {
    expect(decodeEntities('a &amp; b &lt;x&gt; &quot;q&quot;')).toBe('a & b <x> "q"');
  });

  it('双重编码 &amp;#x2F; 仅解一层 → &#x2F;（不过度解码成 /）', () => {
    expect(decodeEntities('path &amp;#x2F; here')).toBe('path &#x2F; here');
    expect(decodeEntities('a &amp;amp; b')).toBe('a &amp; b');
  });

  it('未识别命名实体 / 非法码点 / 残缺实体一律原样保留', () => {
    expect(decodeEntities('&unknownentity; &#xZZ; &#; &amp')).toBe(
      '&unknownentity; &#xZZ; &#; &amp',
    );
  });

  it('幂等：对已解码文本再跑一次不变（回填可重复执行）', () => {
    const clean = decodeEntities('https:&#x2F;&#x2F;x.com&#x2F;a it&#x27;s & ok');
    expect(decodeEntities(clean)).toBe(clean);
  });

  it('只碰实体、不碰标签：正文里的字面 <...> 原样保留（回填安全）', () => {
    expect(decodeEntities('use <b> for &amp; bold')).toBe('use <b> for & bold');
  });
});

describe('decodeHtml（HN 富文本 → 纯文本）', () => {
  it('含 <a href> 的样例：转「文本 (链接)」且链接与文本内实体一并解码', () => {
    const input =
      '<a href="https:&#x2F;&#x2F;example.com&#x2F;x" rel="nofollow">https:&#x2F;&#x2F;example.com&#x2F;x</a>';
    expect(decodeHtml(input)).toBe('https://example.com/x (https://example.com/x)');
  });

  it('<p> → 空行、<br> → 换行，其余标签剥除', () => {
    expect(decodeHtml('one<p>two<br>three<i>x</i>')).toBe('one\n\ntwo\nthreex');
  });

  it('先剥标签后解实体：被转义的 &lt;b&gt; 作为字面文本 <b> 保留', () => {
    expect(decodeHtml('use &lt;b&gt; for bold')).toBe('use <b> for bold');
  });

  it('综合：标签结构 + 残留十六进制实体一并清理，并 trim', () => {
    expect(decodeHtml('  <p>see https:&#x2F;&#x2F;a.com&#x2F;b it&#x27;s great  ')).toBe(
      "see https://a.com/b it's great",
    );
  });
});
