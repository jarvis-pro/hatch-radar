/**
 * 行类型：Prisma 生成的模型类型（原始）与对外域类型（bigint→number）的桥接。
 *
 * Prisma 把 PG `bigint`（Unix 秒）映射成 JS `bigint`、`jsonb` 映射成 `JsonValue`，
 * 与 `@hatch-radar/shared` 的「数字时间戳 / 已解析对象」行类型不同——差异收敛到 mappers。
 *
 * posts / comments 的列名与 shared 行类型逐字段对齐：文件末尾用编译期断言锁定
 * 「Prisma 模型（bigint→number、去关系字段）=== PostRow / CommentRow」，任一侧漂移即 tsc 报错。
 */
import type { CommentRow, PostRow } from '@hatch-radar/shared';
import type {
  analysis_jobsModel,
  app_settingsModel,
  commentsModel,
  insightsModel,
  model_providersModel,
  postsModel,
  sync_opsModel,
  triageModel,
} from './generated/prisma/models';

// 便利再导出：让 server 数据层从 @hatch-radar/db 单点取行类型（与表/映射同源）
export type { CommentRow, InsightRow, PostRow } from '@hatch-radar/shared';

/** 把 bigint 列在域类型里折回 number（含可空），其余字段透传 */
type BigIntToNumber<T> = {
  [K in keyof T]: [T[K]] extends [bigint]
    ? number
    : [T[K]] extends [bigint | null]
      ? number | null
      : T[K];
};

// ─── 原始 Prisma 行（时间戳 bigint、jsonb 为 JsonValue）——仅作 mapper 输入 ───────────
export type PostPg = postsModel;
export type CommentPg = commentsModel;
export type InsightPgRow = insightsModel;
export type TriagePgRow = triageModel;
export type SyncOpPgRow = sync_opsModel;
export type JobPg = analysis_jobsModel;
export type ProviderPg = model_providersModel;

// ─── 域行类型（bigint→number）：无 shared 对应物的表在此定义 ──────────────────────────
/** analysis_jobs 行（status / trigger 为枚举，时间戳为 number） */
export type JobRow = BigIntToNumber<analysis_jobsModel>;
/** model_providers 行（api_key 为密文；enabled 为 boolean；时间戳为 number） */
export type ProviderRow = BigIntToNumber<model_providersModel>;
/** app_settings 行（无时间戳列） */
export type AppSettingRow = app_settingsModel;

// ─── 编译期断言：posts/comments 推导类型与 shared 行类型互相可赋值 ────────────────────
// 任一侧字段漂移（改名 / 改可空 / 改类型）都会在此处 tsc 报错，挡住静默契约破坏。
type AssertAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _postRowMatches: AssertAssignable<
  BigIntToNumber<Omit<postsModel, 'comments'>>,
  PostRow
> = true;
const _commentRowMatches: AssertAssignable<
  BigIntToNumber<Omit<commentsModel, 'posts'>>,
  CommentRow
> = true;
void _postRowMatches;
void _commentRowMatches;
