import type { TranslateItem, TranslatedItem } from './translate';

/**
 * 翻译任务的系统 prompt。强调保留结构与语气——审核员要据译文精准理解原意，
 * markdown / 代码 / 链接 / @提及被翻烂会误导判断，故明确要求原样保留。
 */
export const TRANSLATION_SYSTEM_PROMPT = `你是一名专业的多语言翻译，服务于一个社区内容审核系统。把给定的帖子标题、正文与评论翻译成简体中文，供审核员阅读理解。

严格遵守：
- 译成自然、准确的简体中文；忠实原意，不增删、不解释、不评论。
- 原样保留：Markdown 语法、代码块与行内代码、URL 链接、@用户名、引用符号(>)、列表与编号。代码、变量名、产品名、专有标识符不要翻译。
- 保留原文语气，包括讽刺、反话、口语和情绪——这些对判断社区情绪很关键。
- 逐条处理：每条按其 key 返回，lang 填该条源文本的语种代码。
- 若某条源文本本就是简体或繁体中文，text 原样返回该中文、lang 填 zh。`;

/** 源字段类型 → 中文标签（给模型提示该条来自哪里） */
const FIELD_LABEL: Record<string, string> = {
  post_title: '帖子标题',
  post_selftext: '帖子正文',
  comment_body: '评论',
};

/**
 * 把一批待译条目拼成用户消息：逐条带 key + 类型 + 原文，用分隔线隔开。
 * 译文经结构化输出按 key 回传，故无需依赖顺序。
 * @param items 本批待译条目
 */
export function buildTranslationPrompt(items: TranslateItem[]): string {
  const blocks = items.map((it, i) => {
    const label = FIELD_LABEL[it.field] ?? '文本';
    return `【条目 ${i + 1}】\nkey: ${it.key}\n类型: ${label}\n原文:\n${it.text}`;
  });
  return `请把下列 ${items.length} 个条目分别翻译成简体中文，逐条按 key 返回。\n\n${blocks.join('\n\n———\n\n')}`;
}

/**
 * 将模型返回的任意结构归一化为合法的译文条目数组（兜底 schema 之外的脏数据）。
 * 丢弃缺 key / 缺译文的条目；lang 归一为小写。
 * @param raw `structured_output`（已是对象）或 JSON.parse 后的原始对象
 */
export function normalizeTranslationItems(raw: unknown): TranslatedItem[] {
  const data = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((it: Record<string, unknown>) => ({
      key: String(it?.key ?? '').trim(),
      lang: String(it?.lang ?? '')
        .trim()
        .toLowerCase(),
      text: String(it?.text ?? ''),
    }))
    .filter((it) => it.key.length > 0 && it.text.trim().length > 0);
}
