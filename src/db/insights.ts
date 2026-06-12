import type { InsightResult, Intensity, Opportunity, PainPoint } from '../analyzer/prompt';
import type { PostRow } from './posts';
import { getDb } from './schema';

interface InsightRow {
  id: number;
  post_id: string;
  source: string;
  subreddit: string;
  post_title: string;
  permalink: string | null;
  model: string;
  intensity: Intensity;
  pain_points: string;
  opportunities: string;
  tags: string;
  created_at: number;
}

/** searchInsights() 返回的洞察记录（camelCase 视图） */
export interface Insight {
  id: number;
  /** 对应帖子的 ID */
  postId: string;
  /** 数据来源标识：`'reddit'` | `'hackernews'` | `'rss'` */
  source: string;
  /** 版块/频道名称 */
  subreddit: string;
  /** 帖子标题快照（原帖删除后仍可读） */
  postTitle: string;
  /** 帖子链接；Reddit 为相对路径，HN/RSS 为完整 URL */
  permalink: string | null;
  /** 用于生成该洞察的模型 ID */
  model: string;
  /** 本篇洞察中最高强度的痛点等级，用作索引强度 */
  intensity: Intensity;
  painPoints: PainPoint[];
  opportunities: Opportunity[];
  tags: string[];
  /** 洞察写入 Unix 时间戳（秒） */
  createdAt: number;
}

/** searchInsights() 的过滤条件，所有字段可选，多字段以 AND 组合 */
export interface InsightFilter {
  /** 按版块/频道名称精确匹配（大小写不敏感） */
  subreddit?: string;
  /** 按标签模糊匹配（contains） */
  tag?: string;
  /** 按强度等级精确匹配，传入时自动转大写 */
  intensity?: string;
  /** 最多返回条数，默认 20 */
  limit?: number;
}

/**
 * 将 AI 分析结果落库为洞察记录。
 * - intensity 取所有 pain_points 中最高强度，作为整条洞察的索引强度
 * - 同一 post_id 重复写入时覆盖（INSERT OR REPLACE）
 * @param post 来源帖子行（提供 id / source / subreddit / title / permalink）
 * @param model 用于分析的模型 ID
 * @param insight AI 返回的结构化结果
 * @param createdAt 写入 Unix 时间戳（秒）
 */
export function saveInsight(
  post: PostRow,
  model: string,
  insight: InsightResult,
  createdAt: number,
): void {
  const rank: Record<Intensity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  let intensity: Intensity = 'LOW';
  for (const p of insight.pain_points) {
    if (rank[p.intensity] > rank[intensity]) intensity = p.intensity;
  }
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO insights
         (post_id, source, subreddit, post_title, permalink, model, intensity, pain_points, opportunities, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      post.id,
      post.source,
      post.subreddit,
      post.title,
      post.permalink,
      model,
      intensity,
      JSON.stringify(insight.pain_points),
      JSON.stringify(insight.opportunities),
      JSON.stringify(insight.tags),
      createdAt,
    );
}

/**
 * 按条件检索洞察结果，多个过滤条件以 AND 组合。
 * @param filter 过滤条件，所有字段可选
 * @returns 洞察列表，按 created_at 降序排列
 */
export function searchInsights(filter: InsightFilter): Insight[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.subreddit) {
    clauses.push(`subreddit = ? COLLATE NOCASE`);
    params.push(filter.subreddit);
  }
  if (filter.intensity) {
    clauses.push(`intensity = ?`);
    params.push(filter.intensity.toUpperCase());
  }
  if (filter.tag) {
    clauses.push(`EXISTS (SELECT 1 FROM json_each(insights.tags) WHERE json_each.value LIKE ?)`);
    params.push(`%${filter.tag}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM insights ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, filter.limit ?? 20) as InsightRow[];
  return rows.map((row) => ({
    id: row.id,
    postId: row.post_id,
    source: row.source,
    subreddit: row.subreddit,
    postTitle: row.post_title,
    permalink: row.permalink,
    model: row.model,
    intensity: row.intensity,
    painPoints: JSON.parse(row.pain_points) as PainPoint[],
    opportunities: JSON.parse(row.opportunities) as Opportunity[],
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
  }));
}
