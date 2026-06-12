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

/** 单篇帖子的 AI 分析结果，作为模型结构化输出的顶层对象 */
export interface InsightResult {
  /** 识别出的痛点清单；无实质信号时为空数组 */
  pain_points: PainPoint[];
  /** 由痛点推导出的产品机会；无实质信号时为空数组 */
  opportunities: Opportunity[];
  /** 3-6 个中文主题标签，便于后续检索 */
  tags: string[];
}

/** 分析任务的系统 prompt，要求模型从社区内容中提炼痛点与产品机会 */
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
 * @returns 发送给模型的用户消息字符串
 */
export function buildUserPrompt(context: string): string {
  return `请分析以下社区内容：\n\n${context}`;
}

/**
 * InsightResult 的 JSON 示例骨架（人类与模型均可读）。
 * - DeepSeek JSON 模式的格式约束、以及本地文件导出的「输出格式」段落共用此常量
 * - 字段含义与 {@link InsightResult} / {@link INSIGHT_SCHEMA} 保持一致
 */
export const INSIGHT_JSON_EXAMPLE = `{
  "pain_points": [
    { "description": "用中文概括的痛点", "evidence": "原帖/评论中的引用片段（保留原语言，不得改写）", "intensity": "HIGH | MEDIUM | LOW" }
  ],
  "opportunities": [
    { "title": "机会名称（中文）", "description": "产品形态与核心价值（中文）", "target_user": "目标用户画像（中文）" }
  ],
  "tags": ["标签1", "标签2", "标签3"]
}`;

/** 不支持原生 JSON Schema 的模型（如 DeepSeek）追加到 system prompt 末尾的输出约束 */
export const JSON_OUTPUT_DIRECTIVE = `请仅输出一个 JSON 对象，不要包含任何额外说明文字，也不要使用 Markdown 代码块包裹。结构如下：\n${INSIGHT_JSON_EXAMPLE}`;

function normalizeIntensity(value: unknown): Intensity {
  const upper = String(value).toUpperCase();
  return upper === 'HIGH' || upper === 'LOW' ? upper : 'MEDIUM';
}

/**
 * 将模型返回的任意 JSON 归一化为合法的 {@link InsightResult}。
 * - 结构化输出已由 schema 约束（Anthropic）或 prompt 约束（DeepSeek），这里再做一层兜底
 * - 丢弃缺失 description / title 的条目，强度非法时回退 MEDIUM
 * @param raw `JSON.parse` 后的原始对象
 * @returns 字段齐全、可直接落库的分析结果
 */
export function normalizeInsight(raw: unknown): InsightResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const painPoints = Array.isArray(data.pain_points) ? data.pain_points : [];
  const opportunities = Array.isArray(data.opportunities) ? data.opportunities : [];
  const tags = Array.isArray(data.tags) ? data.tags : [];
  return {
    pain_points: painPoints
      .map((p: Record<string, unknown>) => ({
        description: String(p?.description ?? '').trim(),
        evidence: String(p?.evidence ?? '').trim(),
        intensity: normalizeIntensity(p?.intensity),
      }))
      .filter((p) => p.description.length > 0),
    opportunities: opportunities
      .map((o: Record<string, unknown>) => ({
        title: String(o?.title ?? '').trim(),
        description: String(o?.description ?? '').trim(),
        target_user: String(o?.target_user ?? '').trim(),
      }))
      .filter((o) => o.title.length > 0),
    tags: tags.map((t) => String(t).trim()).filter((t) => t.length > 0),
  };
}

/**
 * 传给 Anthropic API `output_config.format` 的 JSON Schema。
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
