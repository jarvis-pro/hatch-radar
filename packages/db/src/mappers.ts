/**
 * Prisma 行 ⇄ 域类型映射（单点收敛 bigint→number 与 jsonb 解析/序列化）。
 *
 * - Prisma 读出的 jsonb 已是对象/数组（JsonValue），故面向 web/检索的 camelCase 视图直接搬字段；
 * - 面向导出/同步契约的 `*Row`（snake_case、JSON 为字符串）→ 把 jsonb `stringify` 回 TEXT，
 *   保 mobile `ATTACH` 合并与 HTTP JSON 批次的字节级兼容；
 * - 所有 Unix 秒时间戳列由 bigint 折回 number（域类型口径）。
 */
import type {
  CommentRow,
  Insight,
  InsightRow,
  Opportunity,
  PainPoint,
  PostRow,
  Triage,
} from '@hatch-radar/shared';
import type {
  CommentPg,
  InsightPgRow,
  JobPg,
  JobRow,
  PostPg,
  ProviderApiKeyPg,
  ProviderApiKeyRow,
  ProviderPg,
  ProviderRow,
  TriagePgRow,
} from './types';

/** bigint Unix 秒 → number */
const n = (v: bigint): number => Number(v);
/** 可空 bigint Unix 秒 → number | null */
const nOpt = (v: bigint | null): number | null => (v === null ? null : Number(v));

/** Prisma posts 行 → 域 PostRow（时间戳 bigint→number；关系字段不参与） */
export function toPostRow(m: PostPg): PostRow {
  return {
    ...m,
    created_utc: n(m.created_utc),
    fetched_at: n(m.fetched_at),
    comments_fetched_at: nOpt(m.comments_fetched_at),
    comments_changed_at: nOpt(m.comments_changed_at),
    export_locked_at: nOpt(m.export_locked_at),
    analyzed_at: nOpt(m.analyzed_at),
  };
}

/** Prisma comments 行 → 域 CommentRow（时间戳 bigint→number） */
export function toCommentRow(m: CommentPg): CommentRow {
  return { ...m, created_utc: n(m.created_utc), fetched_at: n(m.fetched_at) };
}

/** Prisma analysis_jobs 行 → 域 JobRow（时间戳 bigint→number） */
export function toJobRow(m: JobPg): JobRow {
  return {
    ...m,
    enqueued_at: n(m.enqueued_at),
    started_at: nOpt(m.started_at),
    finished_at: nOpt(m.finished_at),
    heartbeat_at: nOpt(m.heartbeat_at),
  };
}

/** Prisma model_providers 行 → 域 ProviderRow（时间戳 bigint→number；keys 关系不参与） */
export function toProviderRow(m: ProviderPg): ProviderRow {
  return { ...m, created_at: n(m.created_at), updated_at: n(m.updated_at) };
}

/** Prisma provider_api_keys 行 → 域 ProviderApiKeyRow（cooldown_until / 时间戳 bigint→number） */
export function toProviderApiKeyRow(m: ProviderApiKeyPg): ProviderApiKeyRow {
  return {
    ...m,
    cooldown_until: nOpt(m.cooldown_until),
    created_at: n(m.created_at),
    updated_at: n(m.updated_at),
  };
}

/** Prisma insights 行 → camelCase 视图（jsonb 已解析；web / 检索用） */
export function toInsight(m: InsightPgRow): Insight {
  return {
    id: m.id,
    postId: m.post_id,
    source: m.source,
    subreddit: m.subreddit,
    postTitle: m.post_title,
    permalink: m.permalink,
    model: m.model,
    intensity: m.intensity,
    painPoints: m.pain_points as unknown as PainPoint[],
    opportunities: m.opportunities as unknown as Opportunity[],
    tags: m.tags as string[],
    createdAt: n(m.created_at),
  };
}

/**
 * Prisma insights 行 → 导出行结构（jsonb stringify 回 TEXT）。
 * 导出 .sqlite 与 HTTP JSON 批次都按此结构（mobile 落库 TEXT 列）。
 */
export function toInsightRow(m: InsightPgRow): InsightRow {
  return {
    id: m.id,
    post_id: m.post_id,
    source: m.source,
    subreddit: m.subreddit,
    post_title: m.post_title,
    permalink: m.permalink,
    model: m.model,
    intensity: m.intensity,
    pain_points: JSON.stringify(m.pain_points),
    opportunities: JSON.stringify(m.opportunities),
    tags: JSON.stringify(m.tags),
    created_at: n(m.created_at),
  };
}

/** Prisma triage 行 → camelCase 视图（tags 已是数组） */
export function toTriage(m: TriagePgRow): Triage {
  return {
    insightId: m.insight_id,
    status: m.status,
    rating: m.rating,
    tags: m.tags as string[],
    note: m.note,
    updatedAt: n(m.updated_at),
  };
}
