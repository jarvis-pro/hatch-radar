import type { InsightResult, Intensity } from '@hatch-radar/shared';

/** 分析任务的系统 prompt，要求模型从社区内容中提炼痛点与产品机会 */
export const SYSTEM_PROMPT = `你是一名资深市场研究分析师，专注于从社区讨论中挖掘真实的用户痛点与产品机会。

从以下帖子与评论中提炼真实存在的痛点与产品机会，严格按如下格式输出；
只提炼有明确信号的内容，不要臆造；若只是闲聊、新闻转发或纯链接，pain_points 与 opportunities 返回空数组；
一篇帖子通常只有 0-3 个真正值得记录的痛点，不要把同一问题拆成多条。`;

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
 * - 字段含义与 {@link InsightResult} 保持一致（结构化 schema 见 insight-schema.ts）
 */
export const INSIGHT_JSON_EXAMPLE = `{
  "pain_points": [
    { "description": "用中文概括的痛点", "evidence": "原帖/评论中的引用片段（保留原语言，不得改写）", "intensity": "HIGH | MEDIUM | LOW（按情绪强烈程度与评论附和度分级）" }
  ],
  "opportunities": [
    { "title": "机会名称（中文）", "description": "产品形态与核心价值（中文）", "target_user": "目标用户画像（中文）" }
  ],
  "tags": ["中文主题标签（3-6 个，如：效率工具、SaaS、数据导出）"]
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
