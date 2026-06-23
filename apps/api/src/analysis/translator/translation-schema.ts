import { z } from 'zod';

/**
 * 翻译结构化输出的「单一数据源」——一份 Zod schema 既生成交给模型的 JSON Schema
 * （claude_cli 的 outputFormat / OpenAI json_schema 共用，强制逐条结构化返回），
 * 又用 `.describe()` 作为给模型的字段说明。逐条带 key 回传以对回源条目，免按顺序猜。
 */

/** 单条译文结果：key 原样回传 + 源语种 + 中文译文 */
const TranslationItemSchema = z.object({
  key: z.string().describe('条目标识，原样回传（用于把译文对回源文本，不要改动）'),
  lang: z
    .string()
    .describe('源文本语种的 ISO 639-1 代码（如 en/ja/de/ru/ko）；源文本本就是中文则填 zh'),
  text: z.string().describe('译成简体中文的结果；若源文本本就是中文，原样返回'),
});

/** 一批译文结果（与输入逐条对应） */
export const TranslationBatchZodSchema = z.object({
  items: z.array(TranslationItemSchema).describe('与输入条目逐条对应的译文结果'),
});

/** 批量翻译结果类型（结构化输出落在此形态） */
export type TranslationBatchResult = z.infer<typeof TranslationBatchZodSchema>;

function buildTranslationJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(TranslationBatchZodSchema) as Record<string, unknown>;
  delete schema.$schema;

  return schema;
}

/** 运行时传给模型的 JSON Schema（claude_cli outputFormat=json_schema 用） */
export const TRANSLATION_JSON_SCHEMA = buildTranslationJsonSchema();
