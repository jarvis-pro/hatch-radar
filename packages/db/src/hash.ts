import { createHash } from 'node:crypto';

/**
 * 源文本 → 内容哈希（译文缓存键 / 增量探测器）。
 *
 * 规范化：去首尾空白后取 sha256 十六进制。空串 / 纯空白 → null——链接帖空正文、空标题等
 * 无需翻译，不占缓存键（其 *_hash 列为 NULL，未翻译查询自然跳过）。
 *
 * 入库时算一次写进 posts.title_hash / posts.selftext_hash / comments.body_hash；译文按此哈希
 * 寻址（translations.content_hash），故评论 replaceComments 整删整插后同文仍命中既有译文、
 * 新评论则未命中=待翻译——「首次 vs 增量」无需额外检测逻辑。
 *
 * @param text 源文本（已在抓取层 decode 过 HTML 实体）
 * @returns sha256 十六进制；空白文本返回 null
 */
export function contentHash(text: string | null | undefined): string | null {
  if (text == null) return null;
  const normalized = text.trim();
  if (normalized.length === 0) return null;
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
