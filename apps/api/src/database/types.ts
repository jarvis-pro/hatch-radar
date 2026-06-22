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
  app_settingsModel,
  commentsModel,
  insightsModel,
  model_providersModel,
  postsModel,
  provider_api_keysModel,
  source_connectorsModel,
  sourcesModel,
  sync_opsModel,
  translationsModel,
  triageModel,
  blueprintsModel,
  processesModel,
  runsModel,
  tasksModel,
  task_stagesModel,
  request_queueModel,
  request_lanesModel,
} from './generated/prisma/models';

// 便利再导出：让 server 数据层从 @/database 单点取行类型（与表/映射同源）
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
export type ProviderPg = model_providersModel;
export type ProviderApiKeyPg = provider_api_keysModel;
export type SourcePg = sourcesModel;
export type SourceConnectorPg = source_connectorsModel;
export type TranslationPg = translationsModel;
export type BlueprintPg = blueprintsModel;
export type ProcessPg = processesModel;
export type RunPg = runsModel;
export type TaskPg = tasksModel;
export type TaskStagePg = task_stagesModel;
export type RequestQueuePg = request_queueModel;
export type RequestLanePg = request_lanesModel;

// ─── 域行类型（bigint→number）：无 shared 对应物的表在此定义 ──────────────────────────
/** model_providers 行（enabled 为 boolean；时间戳为 number；不含 keys 关系——密钥在 ProviderApiKeyRow） */
export type ProviderRow = BigIntToNumber<Omit<model_providersModel, 'keys'>>;
/** provider_api_keys 行（api_key 为密文；status 为枚举；cooldown_until / 时间戳为 number；不含 provider 反向关系） */
export type ProviderApiKeyRow = BigIntToNumber<Omit<provider_api_keysModel, 'provider'>>;
/** sources 行（platform 为枚举；config 为 JsonValue；时间戳为 number） */
export type SourceRow = BigIntToNumber<sourcesModel>;
/** source_connectors 行（secret 为密文 JSON；auth_kind 为枚举；last_check_at / 时间戳为 number） */
export type SourceConnectorRow = BigIntToNumber<source_connectorsModel>;
/** app_settings 行（无时间戳列） */
export type AppSettingRow = app_settingsModel;
/** translations 行（source_field / status / provider_kind 为枚举；时间戳为 number） */
export type TranslationRow = BigIntToNumber<translationsModel>;

// ─── 图纸驱动生命周期行类型（status/kind 为字符串常量；时间戳 bigint→number；详见 schema） ───
/** blueprints 行（sources / params / gates / enabled_stages 为 JsonValue；时间戳为 number） */
export type BlueprintRow = BigIntToNumber<blueprintsModel>;
/** processes 行（trigger_config 为 JsonValue；last_run_at / next_run_at / 时间戳为 number|null） */
export type ProcessRow = BigIntToNumber<processesModel>;
/** runs 行（params 为 JsonValue；process_id / sweep_seq 可空；时间戳为 number） */
export type RunRow = BigIntToNumber<runsModel>;
/** tasks 行（status / kind 为字符串；params 为 JsonValue；usage / 时间戳为 number|null） */
export type TaskRow = BigIntToNumber<tasksModel>;
/** task_stages 行（status / name 为字符串；input_summary / output 为 JsonValue；时间戳为 number） */
export type TaskStageRow = BigIntToNumber<task_stagesModel>;
/** request_queue 行（params / result 为 JsonValue；时间戳为 number） */
export type RequestQueueRow = BigIntToNumber<request_queueModel>;
/** request_lanes 行（时间戳为 number） */
export type RequestLaneRow = BigIntToNumber<request_lanesModel>;

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
