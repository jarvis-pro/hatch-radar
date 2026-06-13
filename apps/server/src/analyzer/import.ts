import { saveInsight } from '../db/insights';
import { clearExportLock, getPostById } from '../db/posts';
import { nowSec } from '../db/utils';
import { logger } from '../logger';
import { normalizeInsight } from './prompt';

/** importManualResult 的回灌结果 */
export interface ImportOutcome {
  /**
   * - `imported`：已解析并落库
   * - `not_found`：帖子不存在或已归档（无法取 source/subreddit 等字段）
   * - `invalid_json`：粘贴的文本中找不到可解析的 JSON 对象
   */
  outcome: 'imported' | 'not_found' | 'invalid_json';
  /** 目标帖子 ID（原样回显） */
  postId: string;
  /** outcome=imported：落库的痛点数 */
  painPoints?: number;
  /** outcome=imported：落库的机会数 */
  opportunities?: number;
  /** outcome=imported：是否含有效信号（痛点或机会非空） */
  signal?: boolean;
}

/**
 * 从外部 AI 返回的文本中抽取 JSON 对象。
 * - 容忍 ```json 围栏与 JSON 前后夹带的说明文字：取首个 `{` 到末个 `}` 的子串再解析
 * @param text 用户粘贴的原始文本
 * @returns `JSON.parse` 后的对象
 * @throws 文本中不含成对花括号、或子串非合法 JSON 时抛出
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('未找到 JSON 对象');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * 将手动获取的 AI 分析结果回灌为洞察（AI_PROVIDER=file 模式闭环的「收料」步）。
 * - 按 post_id 落库（saveInsight 用 INSERT OR REPLACE，天然幂等；重复回灌覆盖）
 * - 无信号（痛点与机会均空）也落一条空洞察，使该帖离开「待回填」列表；
 *   空洞察由 export/batch 的有效数据基线过滤，不会下发给移动端
 * - model 记为 `'manual'`，区分人工回填与模型产出
 * @param postId 目标帖子 ID（取自待分析文档头部）
 * @param resultText 用户粘贴的外部 AI 返回文本
 * @returns 回灌结果，由调用方（HTTP 端点 / CLI）映射为响应
 */
export function importManualResult(postId: string, resultText: string): ImportOutcome {
  const post = getPostById(postId);
  if (!post) return { outcome: 'not_found', postId };

  let parsed: unknown;
  try {
    parsed = extractJsonObject(resultText);
  } catch {
    return { outcome: 'invalid_json', postId };
  }

  const insight = normalizeInsight(parsed);
  saveInsight(post, 'manual', insight, nowSec());
  clearExportLock(post.id); // 回灌即解冻，让评论 refresh 恢复跟踪该帖
  const painPoints = insight.pain_points.length;
  const opportunities = insight.opportunities.length;
  logger.info(
    `  ✓ 回灌 r/${post.subreddit}「${post.title.slice(0, 48)}」→ 痛点 ${painPoints} / 机会 ${opportunities}`,
  );
  return {
    outcome: 'imported',
    postId,
    painPoints,
    opportunities,
    signal: painPoints + opportunities > 0,
  };
}
