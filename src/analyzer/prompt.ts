export type Intensity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PainPoint {
  description: string;
  evidence: string;
  intensity: Intensity;
}

export interface Opportunity {
  title: string;
  description: string;
  target_user: string;
}

export interface InsightResult {
  pain_points: PainPoint[];
  opportunities: Opportunity[];
  tags: string[];
}

export const SYSTEM_PROMPT = `你是一名资深市场研究分析师，专注于从社区讨论中挖掘真实的用户痛点与产品机会。

你将收到一篇 Reddit 帖子及其热门评论，请基于内容提炼：

1. pain_points（痛点清单）：用户明确表达或强烈暗示的问题、抱怨、未被满足的需求。
   - description：用中文清晰概括痛点
   - evidence：引用原帖或评论中最能支撑该痛点的片段（保留原语言，可截选，不得改写）
   - intensity：强度分级 HIGH / MEDIUM / LOW，综合考虑表达的情绪强烈程度、附和评论数量与点赞数
2. opportunities（产品机会）：由痛点推导出的可行产品方向。
   - title：机会名称（中文）
   - description：产品形态与核心价值（中文）
   - target_user：目标用户画像（中文）
3. tags：3-6 个中文标签，便于后续按主题检索（如「效率工具」「SaaS」「数据导出」）

要求：
- 只提炼帖子和评论中真实存在的信号，不要凭空编造，宁缺毋滥
- 若内容只是闲聊、新闻转发、纯链接分享等，没有可挖掘的痛点，pain_points 与 opportunities 返回空数组
- 一篇帖子通常只有 0-3 个真正值得记录的痛点，不要把同一问题拆成多条`;

export function buildUserPrompt(context: string): string {
  return `请分析以下 Reddit 内容：\n\n${context}`;
}

/** 结构化输出 schema，与 README「洞察输出格式」一致 */
export const INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    pain_points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          evidence: { type: 'string' },
          intensity: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
        },
        required: ['description', 'evidence', 'intensity'],
        additionalProperties: false,
      },
    },
    opportunities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          target_user: { type: 'string' },
        },
        required: ['title', 'description', 'target_user'],
        additionalProperties: false,
      },
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['pain_points', 'opportunities', 'tags'],
  additionalProperties: false,
} as const;
