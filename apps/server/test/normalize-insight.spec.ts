import { describe, expect, it } from 'vitest';
import { normalizeInsight } from '../src/analyzer/prompt';

/** 模型输出归一化兜底：丢弃缺字段条目、强度回退、过滤空标签、容忍非法输入。 */
describe('normalizeInsight（模型输出归一化）', () => {
  it('丢弃缺 description 的痛点、缺 title 的机会，过滤空标签', () => {
    const out = normalizeInsight({
      pain_points: [
        { description: '有效痛点', evidence: 'e', intensity: 'HIGH' },
        { description: '', evidence: 'x', intensity: 'LOW' },
      ],
      opportunities: [
        { title: '有效机会', description: 'd', target_user: 'u' },
        { title: '', description: 'd', target_user: 'u' },
      ],
      tags: ['a', '', '  ', 'b'],
    });
    expect(out.pain_points).toHaveLength(1);
    expect(out.pain_points[0].description).toBe('有效痛点');
    expect(out.opportunities).toHaveLength(1);
    expect(out.opportunities[0].title).toBe('有效机会');
    expect(out.tags).toEqual(['a', 'b']);
  });

  it('非法 intensity 回退 MEDIUM，小写归一为大写', () => {
    const out = normalizeInsight({
      pain_points: [
        { description: 'p1', evidence: '', intensity: 'high' },
        { description: 'p2', evidence: '', intensity: 'bogus' },
      ],
      opportunities: [],
      tags: [],
    });
    expect(out.pain_points[0].intensity).toBe('HIGH');
    expect(out.pain_points[1].intensity).toBe('MEDIUM');
  });

  it('非对象 / 缺字段输入产出空结构而非抛错', () => {
    const empty = { pain_points: [], opportunities: [], tags: [] };
    expect(normalizeInsight(null)).toEqual(empty);
    expect(normalizeInsight({})).toEqual(empty);
    expect(normalizeInsight('garbage')).toEqual(empty);
  });
});
