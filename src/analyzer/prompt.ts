/** 痛点强度等级：综合情绪激烈程度、附和评论数与点赞数综合判断 */
export type Intensity = 'HIGH' | 'MEDIUM' | 'LOW';

/** 从社区内容中提炼出的用户痛点 */
export interface PainPoint {
  /** 痛点的中文概括描述 */
  description: string;
  /** 原文中支撑该痛点的引用片段，保留原语言，不得改写 */
  evidence: string;
  /** 该痛点的强度等级 */
  intensity: Intensity;
}

/** 由痛点推导出的可行产品方向 */
export interface Opportunity {
  /** 机会名称（中文） */
  title: string;
  /** 产品形态与核心价值描述（中文） */
  description: string;
  /** 目标用户画像（中文） */
  target_user: string;
}

/** 单篇帖子的 AI 分析结果，作为 Claude 结构化输出的顶层对象 */
export interface InsightResult {
  /** 识别出的痛点清单；无实质信号时为空数组 */
  pain_points: PainPoint[];
  /** 由痛点推导出的产品机会；无实质信号时为空数组 */
  opportunities: Opportunity[];
  /** 3-6 个中文主题标签，便于后续检索 */
  tags: string[];
}

/** 分析任务的系统 prompt，要求 Claude 从社区内容中提炼痛点与产品机会 */
export const SYSTEM_PROMPT = `你是一名资深市场研究分析师，专注于从社区讨论中挖掘真实的用户痛点与产品机会。

你将收到一篇社区帖子及其评论（可能来自 Reddit、Hacker News 或 RSS 订阅），请基于内容提炼：

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

/**
 * 将已构建好的帖子上下文包装为用户消息。
 * @param context buildContext() 生成的多行文本
 * @returns 发送给 Claude 的用户消息字符串
 */
export function buildUserPrompt(context: string): string {
  return `请分析以下社区内容：\n\n${context}`;
}

/**
 * 传给 Claude API `output_config.format` 的 JSON Schema。
 * - 与 README 洞察输出格式及 InsightResult 类型定义保持一致
 * - 修改此 schema 时需同步更新 InsightResult 接口
 */
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
