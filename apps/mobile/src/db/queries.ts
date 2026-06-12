import {
  rowToInsight,
  type CommentRow,
  type Insight,
  type InsightRow,
  type Intensity,
  type PostRow,
} from '@hatch-radar/shared';
import { getDb, getMeta } from './schema';

/** 本地库概览（首页头部展示） */
export interface LocalStats {
  insights: number;
  posts: number;
  comments: number;
  /** 最近一次导入批次的 Unix 秒；从未导入为 null */
  lastImportAt: number | null;
}

export function getLocalStats(): LocalStats {
  const db = getDb();
  const count = (sql: string): number => db.getFirstSync<{ n: number }>(sql)?.n ?? 0;
  const lastImport = getMeta('last_import_at');
  return {
    insights: count(`SELECT COUNT(*) n FROM insights`),
    posts: count(`SELECT COUNT(*) n FROM posts`),
    comments: count(`SELECT COUNT(*) n FROM comments`),
    lastImportAt: lastImport ? Number(lastImport) : null,
  };
}

/** 按强度筛选本地洞察，按生成时间倒序（骨架阶段不分页，本地数据量可控） */
export function listInsights(intensity?: Intensity): Insight[] {
  const where = intensity ? `WHERE intensity = ?` : '';
  const rows = getDb().getAllSync<InsightRow>(
    `SELECT * FROM insights ${where} ORDER BY created_at DESC, id DESC`,
    intensity ? [intensity] : [],
  );
  return rows.map(rowToInsight);
}

export function getInsight(id: number): Insight | null {
  const row = getDb().getFirstSync<InsightRow>(`SELECT * FROM insights WHERE id = ?`, [id]);
  return row ? rowToInsight(row) : null;
}

/** 洞察关联的帖子；批次未含该帖（已归档）时为 null */
export function getPost(id: string): PostRow | null {
  return getDb().getFirstSync<PostRow>(`SELECT * FROM posts WHERE id = ?`, [id]) ?? null;
}

/** 帖子评论，按时间升序；depth 字段已存储，直接用于缩进展示 */
export function getComments(postId: string): CommentRow[] {
  return getDb().getAllSync<CommentRow>(
    `SELECT * FROM comments WHERE post_id = ? ORDER BY created_utc ASC, id`,
    [postId],
  );
}
