import { describe, expect, it } from 'vitest';
import { insightFromMessage } from '@hatch-radar/analysis';

/**
 * claude_cli 订阅模式的「result 消息分发」纯逻辑单测。
 * 直接测 insightFromMessage（不经 query() 子进程）：避免单测真起 claude（慢、耗订阅额度、CI 无登录）。
 * 端到端的 query() 串接由双进程冒烟覆盖。
 */
describe('claude_cli：insightFromMessage（query result 分发）', () => {
  it('非 result 消息 → null（继续读流）', () => {
    expect(insightFromMessage({ type: 'assistant' })).toBeNull();
    expect(insightFromMessage({ type: 'system' })).toBeNull();
    expect(insightFromMessage({ type: 'stream_event' })).toBeNull();
  });

  it('success + structured_output → 归一化结果', () => {
    const r = insightFromMessage({
      type: 'result',
      subtype: 'success',
      structured_output: {
        pain_points: [{ description: '痛点', evidence: '原文', intensity: 'HIGH' }],
        opportunities: [{ title: '机会', description: '形态', target_user: '人群' }],
        tags: ['a', 'b'],
      },
    });
    expect(r).not.toBeNull();
    expect(r!.pain_points).toHaveLength(1);
    expect(r!.pain_points[0].intensity).toBe('HIGH');
    expect(r!.opportunities[0].title).toBe('机会');
    expect(r!.tags).toEqual(['a', 'b']);
  });

  it('success 但缺 structured_output → 抛错', () => {
    expect(() => insightFromMessage({ type: 'result', subtype: 'success' })).toThrow(
      /structured_output/,
    );
  });

  it('error subtype → 抛错（带 subtype 与 errors）', () => {
    expect(() =>
      insightFromMessage({ type: 'result', subtype: 'error_max_turns', errors: ['boom'] }),
    ).toThrow(/error_max_turns：boom/);
  });
});
