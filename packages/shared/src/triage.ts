/**
 * 人工研判（triage）数据结构（docs/multiplatform-refactor-spec.md §C/§D）。
 *
 * 移动端离线研判的本地表与服务端「接收同步」后的落库表共用同一结构：
 * - 移动端：每次变更先写本表（local-first），同时向 outbox 追加操作日志
 * - 服务端：按 op_id 幂等应用移动端推送的操作，结果落入同名表
 *
 * triage 与 insights 按 insight_id 一对一，软引用（洞察被重分析替换 id 后，
 * 旧研判记录保留不动，永不自动删除）。
 */

/** 研判状态全集（zod / CHECK 约束 / UI 选项共用一份字面量） */
export const TRIAGE_STATUSES = ['pending', 'shortlisted', 'archived'] as const;

/** 研判状态：待研判 / 已入选 / 已归档 */
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

/** triage 表的行结构（tags 为 JSON 字符串） */
export interface TriageRow {
  /** 对应 insights.id */
  insight_id: number;
  status: TriageStatus;
  /** 评级 1-5；未评级为 null */
  rating: number | null;
  /** JSON 字符串数组（人工研判标签，区别于洞察自带的 AI 标签） */
  tags: string;
  note: string;
  /** 最近一次研判操作时间，Unix 秒（取操作发生时间，非落库时间） */
  updated_at: number;
}

/** 研判记录的 camelCase 视图（tags 已解析） */
export interface Triage {
  insightId: number;
  status: TriageStatus;
  rating: number | null;
  tags: string[];
  note: string;
  updatedAt: number;
}

/** 将 triage 表原始行解析为 camelCase 视图 */
export function rowToTriage(row: TriageRow): Triage {
  return {
    insightId: row.insight_id,
    status: row.status,
    rating: row.rating,
    tags: JSON.parse(row.tags) as string[],
    note: row.note,
    updatedAt: row.updated_at,
  };
}

/** 尚未研判过的洞察的默认视图（无 triage 行时使用） */
export function emptyTriage(insightId: number): Triage {
  return { insightId, status: 'pending', rating: null, tags: [], note: '', updatedAt: 0 };
}

/** triage 建表 DDL（移动端 / 服务端共用，幂等可重复执行） */
export const TRIAGE_DDL = `-- 人工研判表（移动端本地 + 服务端同步落库共用结构）
CREATE TABLE IF NOT EXISTS triage (
  insight_id INTEGER PRIMARY KEY,            -- 对应 insights.id（软引用）
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shortlisted', 'archived')),
  rating     INTEGER CHECK (rating BETWEEN 1 AND 5),
  tags       TEXT NOT NULL DEFAULT '[]',     -- JSON 字符串数组（研判标签）
  note       TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);`;
