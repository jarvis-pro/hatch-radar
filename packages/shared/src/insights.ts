/** 痛点强度等级：综合情绪激烈程度、附和评论数与点赞数综合判断 */
export type Intensity = 'HIGH' | 'MEDIUM' | 'LOW';

/** 从社区内容中提炼出的用户痛点 */
export interface PainPoint {
  /** 痛点的中文概括描述 */
  description: string;
  /** 原文中支撑该痛点的引用片段，保留原语言，不得改写 */
  evidence: string;
  /** 该痛点的强度等级 */
  intensity: Intensity;
}

/** 由痛点推导出的可行产品方向 */
export interface Opportunity {
  /** 机会名称（中文） */
  title: string;
  /** 产品形态与核心价值描述（中文） */
  description: string;
  /** 目标用户画像（中文） */
  target_user: string;
}

/** 单篇帖子的 AI 分析结果，作为模型结构化输出的顶层对象 */
export interface InsightResult {
  /** 识别出的痛点清单；无实质信号时为空数组 */
  pain_points: PainPoint[];
  /** 由痛点推导出的产品机会；无实质信号时为空数组 */
  opportunities: Opportunity[];
  /** 3-6 个中文主题标签，便于后续检索 */
  tags: string[];
}

/** insights 表的行结构（pain_points / opportunities / tags 为 JSON 字符串） */
export interface InsightRow {
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

/** 洞察记录的 camelCase 视图（JSON 字段已解析），查询接口的标准返回结构 */
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

/** 洞察检索的过滤条件，所有字段可选，多字段以 AND 组合 */
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
 * 将 insights 表的原始行解析为 camelCase 视图。
 * - server / web / 移动端各自的 SQLite 读取路径共用此映射，保证字段语义一致
 * @param row SELECT * 取出的原始行
 */
export function rowToInsight(row: InsightRow): Insight {
  return {
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
  };
}
