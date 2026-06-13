/**
 * hatch-radar PostgreSQL 主存储 schema（Drizzle）。
 *
 * 设计约定（见 docs/server-nest-postgres-refactor-plan.md §4.4）：
 * - 列的 JS key 一律 snake_case，省略显式列名 → 列名与 key 同名，`$inferSelect`
 *   直接对齐 `@hatch-radar/shared` 的行类型（PostRow / CommentRow / JobRow…），零映射。
 * - 时间戳保持 Unix 秒：用 `bigint({ mode: 'number' })`，不转 timestamptz
 *   （保 mobile/导出兼容、行类型不变）。
 * - 原 JSON TEXT（pain_points / opportunities / tags / sync_ops.payload）→ `jsonb`，
 *   (反)序列化收敛到 repository / mappers 边界；导出 .sqlite 时再 stringify 回 TEXT。
 * - CHECK 枚举 → `pgEnum`；0/1 → `boolean`；AUTOINCREMENT → identity（BY DEFAULT，
 *   以便历史迁移保留既有 id，见 §6）。
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Opportunity, PainPoint } from '@hatch-radar/shared';

// ─── 枚举（替代 SQLite 的 TEXT CHECK）─────────────────────────────────────────

/** 痛点 / 洞察强度 */
export const intensityEnum = pgEnum('intensity', ['HIGH', 'MEDIUM', 'LOW']);
/** 人工研判状态 */
export const triageStatusEnum = pgEnum('triage_status', ['pending', 'shortlisted', 'archived']);
/** 分析任务状态机 */
export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
]);
/** 分析任务触发来源 */
export const jobTriggerEnum = pgEnum('job_trigger', ['auto', 'manual']);
/** 模型厂商 */
export const providerKindEnum = pgEnum('provider_kind', ['anthropic', 'openai', 'deepseek']);

/** Unix 秒时间戳列（非空） */
const tsCol = () => bigint({ mode: 'number' });

// ─── 帖子 ─────────────────────────────────────────────────────────────────────

export const posts = pgTable(
  'posts',
  {
    id: text().primaryKey(),
    source: text().notNull().default('reddit'),
    subreddit: text().notNull(),
    title: text().notNull(),
    author: text(),
    selftext: text().notNull().default(''),
    url: text(),
    permalink: text(),
    score: integer().notNull().default(0),
    num_comments: integer().notNull().default(0),
    created_utc: tsCol().notNull(),
    fetched_at: tsCol().notNull(),
    comment_pass: integer().notNull().default(0),
    comments_fetched_at: tsCol(),
    comments_changed_at: tsCol(),
    export_locked_at: tsCol(),
    analyzed_at: tsCol(),
    analyze_attempts: integer().notNull().default(0),
  },
  (t) => [
    index('idx_posts_subreddit').on(t.subreddit),
    index('idx_posts_created').on(t.created_utc),
    index('idx_posts_pending').on(t.analyzed_at, t.comment_pass),
  ],
);

// ─── 评论 ─────────────────────────────────────────────────────────────────────

export const comments = pgTable(
  'comments',
  {
    id: text().primaryKey(),
    post_id: text()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    parent_id: text(),
    author: text(),
    body: text().notNull(),
    score: integer().notNull().default(0),
    depth: integer().notNull().default(0),
    created_utc: tsCol().notNull(),
    fetched_at: tsCol().notNull(),
  },
  (t) => [index('idx_comments_post').on(t.post_id)],
);

// ─── 洞察 ─────────────────────────────────────────────────────────────────────
// 原始帖子归档后仍永久保留；post_id 为软引用 + 唯一（重分析按 post_id upsert，id 不变）。

export const insights = pgTable(
  'insights',
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    post_id: text().notNull(),
    source: text().notNull().default('reddit'),
    subreddit: text().notNull(),
    post_title: text().notNull(),
    permalink: text(),
    model: text().notNull(),
    intensity: intensityEnum().notNull(),
    pain_points: jsonb().$type<PainPoint[]>().notNull(),
    opportunities: jsonb().$type<Opportunity[]>().notNull(),
    tags: jsonb().$type<string[]>().notNull(),
    created_at: tsCol().notNull(),
  },
  (t) => [
    uniqueIndex('idx_insights_post').on(t.post_id),
    index('idx_insights_subreddit').on(t.subreddit),
    index('idx_insights_intensity').on(t.intensity),
  ],
);

// ─── 人工研判（移动端同步落库；insight_id 软引用 insights.id，无 FK）─────────────

export const triage = pgTable(
  'triage',
  {
    insight_id: integer().primaryKey(),
    status: triageStatusEnum().notNull().default('pending'),
    rating: integer(),
    tags: jsonb()
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    note: text().notNull().default(''),
    updated_at: tsCol().notNull(),
  },
  (t) => [check('triage_rating_range', sql`${t.rating} BETWEEN 1 AND 5`)],
);

// ─── 已应用的移动端同步操作（幂等去重 + 审计）────────────────────────────────────

export const syncOps = pgTable('sync_ops', {
  op_id: text().primaryKey(),
  device_id: text().notNull(),
  type: text().notNull(),
  target_id: integer().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  created_at: tsCol().notNull(),
  applied_at: tsCol().notNull(),
});

// ─── 模型清单（密钥加密入库）──────────────────────────────────────────────────

export const modelProviders = pgTable('model_providers', {
  id: integer().primaryKey().generatedByDefaultAsIdentity(),
  provider: providerKindEnum().notNull(),
  label: text().notNull(),
  api_key: text().notNull(),
  base_url: text(),
  model: text().notNull(),
  enabled: boolean().notNull().default(true),
  created_at: tsCol().notNull(),
  updated_at: tsCol().notNull(),
});

// ─── 全局键值配置 ─────────────────────────────────────────────────────────────

export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: text().notNull(),
});

// ─── 持久化分析任务队列（FOR UPDATE SKIP LOCKED 认领）──────────────────────────

export const analysisJobs = pgTable(
  'analysis_jobs',
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    post_id: text().notNull(),
    provider_id: integer(),
    model: text().notNull(),
    trigger: jobTriggerEnum().notNull(),
    status: jobStatusEnum().notNull(),
    attempts: integer().notNull().default(0),
    max_attempts: integer().notNull().default(3),
    error: text(),
    enqueued_at: tsCol().notNull(),
    started_at: tsCol(),
    finished_at: tsCol(),
    heartbeat_at: tsCol(),
  },
  (t) => [
    index('idx_jobs_status').on(t.status, t.enqueued_at),
    index('idx_jobs_post').on(t.post_id),
  ],
);
