/**
 * 导出批次协议（docs/multiplatform-refactor-spec.md §A）。
 *
 * 工作台按条件筛出「有效数据」（有实质信号的洞察 + 关联帖子/评论），
 * 打包为批次供移动端获取，两种载体：
 * - JSON（ExportBatch）：HTTP 接口直接返回，或落地 .json 文件
 * - .sqlite 文件：标准 SQLite 格式（共享 DDL + export_meta 表），AirDrop / 文件导入用
 *
 * 行数据一律用数据库原始行结构（snake_case），server ⇄ mobile 同为 SQLite，
 * 原始行是无损的交换格式，导入端无需字段映射。
 */
import type { CommentRow } from './comments';
import type { InsightRow, Intensity } from './insights';
import type { PostRow } from './posts';

/** 批次格式版本；导入端遇到更高版本时应提示升级而非静默解析。v2 起新增 translations（译文缓存）。 */
export const EXPORT_FORMAT_VERSION = 2;

/** 批次筛选条件；所有字段可选，以 AND 组合。默认只含有实质信号的洞察 */
export interface ExportFilter {
  /** 仅导出该 Unix 时间戳（秒）之后生成的洞察，用于增量拉取 */
  since?: number;
  /** 最低强度：HIGH 只要高强度，MEDIUM 含中高，LOW 等价于不过滤 */
  minIntensity?: Intensity;
  /** 按版块/频道精确匹配（大小写不敏感） */
  subreddit?: string;
  /** 最多导出条数（按生成时间倒序截断） */
  limit?: number;
}

/** 批次元信息 */
export interface ExportMeta {
  formatVersion: number;
  /** 导出时间，Unix 秒 */
  exportedAt: number;
  /** 实际生效的筛选条件 */
  filter: ExportFilter;
  /** 各表行数（导入端校验完整性用） */
  counts: { insights: number; posts: number; comments: number; translations: number };
}

/**
 * 导出的一条译文（仅含已完成译文）。
 * 按「实体种类 + 实体 id」寻址而非内容哈希——移动端用现成的 post.id / comment.id 直接查，
 * 无需在移动端重算哈希、也无需给 posts/comments 加列（避免存量库 ALTER 迁移）。
 */
export interface ExportTranslation {
  /** 实体种类：帖子标题 / 帖子正文 / 评论正文 */
  entity_kind: 'post_title' | 'post_selftext' | 'comment_body';
  /** 实体 id：post_title/post_selftext 为 posts.id；comment_body 为 comments.id */
  entity_id: string;
  /** 中文译文 */
  text: string;
}

/** 一次导出批次（JSON 载体） */
export interface ExportBatch {
  meta: ExportMeta;
  insights: InsightRow[];
  /** 洞察关联的帖子；已归档（30 天清理）的帖子不在其中 */
  posts: PostRow[];
  /** 上述帖子的全部评论 */
  comments: CommentRow[];
  /** 本批帖子/评论已完成的中文译文（按内容哈希；移动端中文优先渲染用），v2 起 */
  translations: ExportTranslation[];
}

/**
 * .sqlite 载体中的译文表：(entity_kind, entity_id) → 中文。移动端 ATTACH 合并后按帖子/评论 id 贴中文。
 * 新表，CREATE IF NOT EXISTS 对存量移动库无痛（无需 ALTER）。
 */
export const TRANSLATIONS_EXPORT_DDL = `CREATE TABLE IF NOT EXISTS translations (
  entity_kind TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  text        TEXT NOT NULL,
  PRIMARY KEY (entity_kind, entity_id)
);`;

/**
 * .sqlite 载体中的元信息表：与 ExportMeta 对应的 key/value。
 * key: format_version / exported_at / filter（JSON 字符串）/ counts（JSON 字符串）
 */
export const EXPORT_META_DDL = `CREATE TABLE IF NOT EXISTS export_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`;
