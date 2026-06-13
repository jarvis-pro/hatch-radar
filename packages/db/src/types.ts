/**
 * 由 Drizzle schema 推导的行类型。
 *
 * posts / comments 的列 key 与 `@hatch-radar/shared` 行类型逐字段对齐，
 * 故 `$inferSelect` 直接 === PostRow / CommentRow（文件末尾有编译期断言兜底）。
 * 含 jsonb 的表（insights / triage / sync_ops）推导类型携带「已解析」的对象，
 * 与 shared 中「JSON 为字符串」的 *Row 类型不同——经 mappers 转换。
 */
import type { CommentRow, PostRow } from '@hatch-radar/shared';
import type {
  analysisJobs,
  appSettings,
  comments,
  insights,
  modelProviders,
  posts,
  syncOps,
  triage,
} from './schema';

// 便利再导出：让 server 数据层从 @hatch-radar/db 单点取行类型（与表/映射同源）
export type { CommentRow, InsightRow, PostRow } from '@hatch-radar/shared';

/** posts 行（=== PostRow） */
export type PostSelect = typeof posts.$inferSelect;
/** comments 行（=== CommentRow） */
export type CommentSelect = typeof comments.$inferSelect;
/** 插入 posts 时的输入形状 */
export type PostInsert = typeof posts.$inferInsert;
/** 插入 comments 时的输入形状 */
export type CommentInsert = typeof comments.$inferInsert;

/** insights 行（jsonb 字段已是对象/数组，非 JSON 字符串） */
export type InsightPgRow = typeof insights.$inferSelect;
/** triage 行（tags 已是 string[]，非 JSON 字符串） */
export type TriagePgRow = typeof triage.$inferSelect;
/** sync_ops 行 */
export type SyncOpPgRow = typeof syncOps.$inferSelect;

/** model_providers 行（api_key 为密文；enabled 为 boolean） */
export type ProviderRow = typeof modelProviders.$inferSelect;
/** app_settings 行 */
export type AppSettingRow = typeof appSettings.$inferSelect;
/** analysis_jobs 行 */
export type JobRow = typeof analysisJobs.$inferSelect;

// ─── 编译期断言：posts/comments 推导类型与 shared 行类型互相可赋值 ────────────────
// 任一侧字段漂移（改名 / 改可空 / 改类型）都会在此处 tsc 报错，挡住静默契约破坏。
type AssertAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _postRowMatches: AssertAssignable<PostSelect, PostRow> = true;
const _commentRowMatches: AssertAssignable<CommentSelect, CommentRow> = true;
void _postRowMatches;
void _commentRowMatches;
