import { describe, expect, it } from 'vitest';
import { looksChinese, translationFromMessage } from '@/analysis';

/**
 * claude_cli 翻译的「result 消息分发」纯逻辑单测。
 * 直接测 translationFromMessage（不经 query() 子进程）：避免单测真起 claude（慢、耗订阅额度、CI 无登录）。
 */
describe('claude_cli：translationFromMessage（query result 分发）', () => {
  it('非 result 消息 → null（继续读流）', () => {
    expect(translationFromMessage({ type: 'assistant' })).toBeNull();
    expect(translationFromMessage({ type: 'stream_event' })).toBeNull();
  });

  it('success + structured_output → 归一化译文条目（丢弃缺 key / 空译文者，lang 归一小写）', () => {
    const r = translationFromMessage({
      type: 'result',
      subtype: 'success',
      structured_output: {
        items: [
          { key: 'h1', lang: 'EN', text: '你好' },
          { key: '', lang: 'en', text: '无 key 应丢弃' },
          { key: 'h2', lang: 'ja', text: '   ' }, // 空白译文应丢弃
          { key: 'h3', lang: 'de', text: '世界' },
        ],
      },
    });
    expect(r).not.toBeNull();
    expect(r!.map((i) => i.key)).toEqual(['h1', 'h3']);
    expect(r![0].lang).toBe('en');
    expect(r![0].text).toBe('你好');
  });

  it('success 但缺 structured_output → 抛错', () => {
    expect(() => translationFromMessage({ type: 'result', subtype: 'success' })).toThrow(
      /structured_output/,
    );
  });

  it('error subtype → 抛错（带 subtype 与 errors）', () => {
    expect(() =>
      translationFromMessage({ type: 'result', subtype: 'error_max_turns', errors: ['boom'] }),
    ).toThrow(/error_max_turns：boom/);
  });
});

describe('looksChinese（中文短路判定：汉字数 ≥ 拉丁字母数）', () => {
  it('中文为主 → true（跳过翻译省额度）', () => {
    expect(looksChinese('这是一段中文评论')).toBe(true);
    expect(looksChinese('完全是中文内容')).toBe(true);
  });

  it('英文为主 / 无汉字 → false（需翻译）', () => {
    expect(looksChinese('This is an English comment')).toBe(false);
    expect(looksChinese('')).toBe(false);
    expect(looksChinese('123 !!! ???')).toBe(false);
  });

  it('中英混合但汉字不占多数 → false（宁可多翻不漏翻）', () => {
    expect(looksChinese('Use the new API 接口')).toBe(false);
  });
});
