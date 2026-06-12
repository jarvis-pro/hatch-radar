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

/** 批次格式版本；导入端遇到更高版本时应提示升级而非静默解析 */
export const EXPORT_FORMAT_VERSION = 1;

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
  counts: { insights: number; posts: number; comments: number };
}

/** 一次导出批次（JSON 载体） */
export interface ExportBatch {
  meta: ExportMeta;
  insights: InsightRow[];
  /** 洞察关联的帖子；已归档（30 天清理）的帖子不在其中 */
  posts: PostRow[];
  /** 上述帖子的全部评论 */
  comments: CommentRow[];
}

/**
 * .sqlite 载体中的元信息表：与 ExportMeta 对应的 key/value。
 * key: format_version / exported_at / filter（JSON 字符串）/ counts（JSON 字符串）
 */
export const EXPORT_META_DDL = `CREATE TABLE IF NOT EXISTS export_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`;
