/**
 * 采集 ingestion 的通用结构：各来源（Reddit / HackerNews / RSS）客户端抓取后统一
 * 映射成这两个形状，再交给持久层落库。零运行时依赖，可被 db / crawler 双方引用。
 *
 * 注：历史命名为 RedditPost / RedditComment，实为通用「帖子 / 评论」结构（不限 Reddit）。
 */

/** 帖子数据的通用结构，供 Reddit / HN / RSS 各客户端统一映射 */
export interface RedditPost {
  /** 帖子唯一 ID；Reddit 格式 `rd_{base36}`，HN 格式 `hn_{id}`，RSS 格式 `rss_{sha1前16位}` */
  id: string;
  /** 版块/频道名称；Reddit 为版块名（不含 r/），其他源为自定义频道标识 */
  subreddit: string;
  /** 帖子标题 */
  title: string;
  /** 发帖人用户名；账号已删除时为 `[deleted]` */
  author: string;
  /** 正文内容；外链帖或无正文时为空字符串 */
  selftext: string;
  /** 外链或来源 URL */
  url: string;
  /** 固定链接；Reddit 为相对路径，HN/RSS 为完整 URL */
  permalink: string;
  /** 帖子得分（赞数减踩数） */
  score: number;
  /** 评论总数（含所有层级） */
  numComments: number;
  /** 发帖 Unix 时间戳（秒） */
  createdUtc: number;
  /** 是否为版主置顶帖；置顶帖在入库前会被过滤 */
  stickied: boolean;
}

/** 评论数据的通用结构，供 Reddit / HN 各客户端统一映射 */
export interface RedditComment {
  /** 评论唯一 ID */
  id: string;
  /** 父评论 ID；顶层评论为 null */
  parentId: string | null;
  /** 评论作者用户名；账号已删除时为 `[deleted]` */
  author: string;
  /** 评论正文；已过滤 [deleted] / [removed] 的评论不入库 */
  body: string;
  /** 点赞数；HN 评论不暴露评分，恒为 0 */
  score: number;
  /** 发评论 Unix 时间戳（秒） */
  createdUtc: number;
  /** 评论深度：0 为顶层，1 为回复，最多回捞 2 层 */
  depth: number;
}
