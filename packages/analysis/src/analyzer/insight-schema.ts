import { z } from 'zod';
import type { InsightResult } from '@hatch-radar/shared';

/**
 * 洞察结构的「单一数据源」——一份 Zod schema 同时供给：
 *   1. {@link INSIGHT_JSON_SCHEMA}：运行时交给模型的 JSON Schema（Anthropic 的 output_config、
 *      OpenAI 的 response_format json_schema strict 共用），强制模型严格按此结构输出；
 *   2. 字段 `.describe()`：写进 JSON Schema 作为给模型的字段说明，也是给人读的文档。
 *
 * 落库用的 TS 类型仍是 {@link InsightResult}（在零依赖的 @hatch-radar/shared 内，
 * 供 web / mobile 共用）。本文件底部的编译期断言保证二者结构完全一致，任一处漂移都会在
 * typecheck 阶段报错——这样「模型契约」与「落库类型」不会脱节。
 *
 * 注意：本包（apps/server）才引入 zod；@hatch-radar/shared 刻意保持零运行时依赖，
 * 故 schema 放这里、类型放 shared，用下方断言把两者绑定。
 */

/** 单条用户痛点：概括 + 原文证据 + 强弱等级 */
const PainPointSchema = z.object({
  description: z.string().describe('用中文清晰概括的痛点'),
  evidence: z.string().describe('原帖/评论中最能支撑该痛点的片段，保留原语言，不得改写'),
  intensity: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('按情绪强烈程度与评论附和度划分的强弱等级'),
});

/** 单条产品机会：名称 + 形态 + 目标用户 */
const OpportunitySchema = z.object({
  title: z.string().describe('机会名称（中文）'),
  description: z.string().describe('产品形态与核心价值（中文）'),
  target_user: z.string().describe('目标用户画像（中文）'),
});

/** 一篇讨论的整体抽取结果 */
export const InsightZodSchema = z.object({
  pain_points: z
    .array(PainPointSchema)
    .describe('用户明确表达或强烈暗示的问题、抱怨、未被满足的需求；宁缺毋滥，通常 0-3 条'),
  opportunities: z.array(OpportunitySchema).describe('由痛点推导出的可行产品方向'),
  tags: z.array(z.string()).describe('3-6 个中文主题标签，便于按主题检索'),
});

/**
 * 交给模型的 JSON Schema：z.toJSONSchema 自动产出 `additionalProperties:false` /
 * `required` / `enum`（正是结构化输出 / OpenAI strict 模式所需），删掉用不到的 `$schema` 元字段。
 */
function buildInsightJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(InsightZodSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** 运行时传给模型的 JSON Schema（Anthropic output_config / OpenAI json_schema strict 共用） */
export const INSIGHT_JSON_SCHEMA = buildInsightJsonSchema();

/**
 * 编译期绑定：Zod 推导类型必须与 @hatch-radar/shared 的 InsightResult 完全一致。
 * 二者结构一旦漂移，下面的赋值就不再合法，typecheck 立即报错。
 */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _schemaMatchesSharedType: Equals<z.infer<typeof InsightZodSchema>, InsightResult> = true;
void _schemaMatchesSharedType;
