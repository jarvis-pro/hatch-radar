/**
 * PG 行 ⇄ 域类型映射。
 *
 * jsonb 字段在 PG 侧读出来已是对象/数组，故：
 * - 面向 web/检索的 `Insight`（camelCase，已解析）→ 直接搬字段，无需 JSON.parse；
 * - 面向导出/同步契约的 `InsightRow`（snake_case，JSON 为字符串）→ 把 jsonb `stringify`
 *   回 TEXT，保 mobile `ATTACH` 合并与 HTTP JSON 批次的字节级兼容。
 */
import type { Insight, InsightRow, Triage } from '@hatch-radar/shared';
import type { InsightPgRow, TriagePgRow } from './types';

/** PG insights 行 → camelCase 视图（jsonb 已解析；web / 检索用） */
export function toInsight(row: InsightPgRow): Insight {
  return {
    id: row.id,
    postId: row.post_id,
    source: row.source,
    subreddit: row.subreddit,
    postTitle: row.post_title,
    permalink: row.permalink,
    model: row.model,
    intensity: row.intensity,
    painPoints: row.pain_points,
    opportunities: row.opportunities,
    tags: row.tags,
    createdAt: row.created_at,
  };
}

/**
 * PG insights 行 → 导出行结构（jsonb stringify 回 TEXT）。
 * 导出 .sqlite 与 HTTP JSON 批次都按此结构（mobile 落库 TEXT 列）。
 */
export function toInsightRow(row: InsightPgRow): InsightRow {
  return {
    id: row.id,
    post_id: row.post_id,
    source: row.source,
    subreddit: row.subreddit,
    post_title: row.post_title,
    permalink: row.permalink,
    model: row.model,
    intensity: row.intensity,
    pain_points: JSON.stringify(row.pain_points),
    opportunities: JSON.stringify(row.opportunities),
    tags: JSON.stringify(row.tags),
    created_at: row.created_at,
  };
}

/** PG triage 行 → camelCase 视图（tags 已是数组） */
export function toTriage(row: TriagePgRow): Triage {
  return {
    insightId: row.insight_id,
    status: row.status,
    rating: row.rating,
    tags: row.tags,
    note: row.note,
    updatedAt: row.updated_at,
  };
}
