import {
  rowToInsight,
  type CommentRow,
  type Insight,
  type InsightRow,
  type Intensity,
  type PostRow,
  type TriageStatus,
} from '@hatch-radar/shared';
import { getDb, getMeta } from './schema';

/** 本地库概览（首页头部展示） */
export interface LocalStats {
  insights: number;
  posts: number;
  comments: number;
  /** 最近一次导入批次的 Unix 秒；从未导入为 null */
  lastImportAt: number | null;
  /** outbox 中待同步的研判操作条数 */
  pendingSync: number;
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
    pendingSync: count(`SELECT COUNT(*) n FROM outbox WHERE synced = 0`),
  };
}

/** 洞察列表项：洞察本体 + 研判摘要（徽标展示用） */
export interface InsightListItem {
  insight: Insight;
  /** 无 triage 行时视为 pending */
  status: TriageStatus;
  rating: number | null;
}

/** 列表筛选条件（强度与研判状态可叠加） */
export interface ListFilter {
  intensity?: Intensity;
  status?: TriageStatus;
}

/** 内部行结构：洞察行 + LEFT JOIN 出的研判摘要列 */
type JoinedRow = InsightRow & { t_status: TriageStatus | null; t_rating: number | null };

/** 按强度/研判状态筛选本地洞察，按生成时间倒序（骨架阶段不分页，本地数据量可控） */
export function listInsights(filter: ListFilter = {}): InsightListItem[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.intensity) {
    clauses.push(`i.intensity = ?`);
    params.push(filter.intensity);
  }
  if (filter.status) {
    clauses.push(`COALESCE(t.status, 'pending') = ?`);
    params.push(filter.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb().getAllSync<JoinedRow>(
    `SELECT i.*, t.status AS t_status, t.rating AS t_rating
     FROM insights i LEFT JOIN triage t ON t.insight_id = i.id
     ${where} ORDER BY i.created_at DESC, i.id DESC`,
    params,
  );
  return rows.map(({ t_status, t_rating, ...insightRow }) => ({
    insight: rowToInsight(insightRow),
    status: t_status ?? 'pending',
    rating: t_rating,
  }));
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
