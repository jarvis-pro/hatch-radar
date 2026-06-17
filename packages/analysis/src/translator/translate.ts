import type { TokenUsage } from '../analyzer/analyze';
import { translateBatchWithClaudeAgent } from './claude-agent';

/** 待译条目（worker 从 translations 仓储取出未翻译条目后投喂） */
export interface TranslateItem {
  /** 源文本内容哈希（= translations.content_hash，回写主键） */
  key: string;
  /** 来源字段标签（post_title | post_selftext | comment_body），仅用于 prompt 提示 */
  field: string;
  /** 待译源文本 */
  text: string;
}

/** 单条译文结果 */
export interface TranslatedItem {
  key: string;
  /** 源语种 ISO 639-1 代码（小写） */
  lang: string;
  /** 简体中文译文 */
  text: string;
}

/**
 * 已解析的翻译方式配置。v1 仅支持 `claude_cli`（订阅额度、零边际成本、最高质量、原生保结构）；
 * 其余 provider（API-Key MT 溢出）留待 P2，届时在此 union 与 {@link translateBatch} 扩展。
 */
export type TranslateConfig = { provider: 'claude_cli'; model: string };

/** 单批最多条数 / 字符数：控制单次 query 体量，避免上下文超限（超出即多批） */
const MAX_ITEMS_PER_BATCH = 40;
const MAX_CHARS_PER_BATCH = 12_000;

/**
 * 粗判文本是否已是中文（汉字数 ≥ 拉丁字母数），命中即跳过翻译省额度。
 * 阈值保守——宁可把中英混合文本送去翻译，也不要把需翻译内容误判为中文而漏翻
 * （漏翻会让审核员在移动端看到看不懂的原文，代价远高于多翻一条）。
 * @param text 源文本
 */
export function looksChinese(text: string): boolean {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  if (han === 0) return false;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return han >= latin;
}

/** 按条数 / 字符预算把条目切成多批 */
function chunk(items: TranslateItem[]): TranslateItem[][] {
  const batches: TranslateItem[][] = [];
  let cur: TranslateItem[] = [];
  let curChars = 0;
  for (const it of items) {
    if (
      cur.length > 0 &&
      (cur.length >= MAX_ITEMS_PER_BATCH || curChars + it.text.length > MAX_CHARS_PER_BATCH)
    ) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(it);
    curChars += it.text.length;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/** 累加 token 用量 */
function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

/** 按 provider 分发单批翻译（扩展新 provider 时在此加分支） */
function translateBatch(
  config: TranslateConfig,
  items: TranslateItem[],
  signal?: AbortSignal,
): Promise<{ results: TranslatedItem[]; usage: TokenUsage | null }> {
  switch (config.provider) {
    case 'claude_cli':
      return translateBatchWithClaudeAgent(config.model, items, signal);
  }
}

/**
 * 翻译一组条目：内部按体量分批多次调用模型，聚合译文与 token 用量。
 * 调用方（worker）应已剔除「本就是中文」的条目（见 {@link looksChinese}），此处只翻真正需要的。
 * @param config 翻译方式配置
 * @param items 待译条目
 * @param signal 可选中止信号（job 超时）
 * @returns 译文条目（按 key 对回）+ 聚合 token 用量
 */
export async function translateItems(
  config: TranslateConfig,
  items: TranslateItem[],
  signal?: AbortSignal,
): Promise<{ results: TranslatedItem[]; usage: TokenUsage | null }> {
  const results: TranslatedItem[] = [];
  let usageAcc: TokenUsage | null = null;
  for (const batch of chunk(items)) {
    signal?.throwIfAborted();
    const { results: r, usage } = await translateBatch(config, batch, signal);
    results.push(...r);
    if (usage) usageAcc = usageAcc ? addUsage(usageAcc, usage) : usage;
  }
  return { results, usage: usageAcc };
}
