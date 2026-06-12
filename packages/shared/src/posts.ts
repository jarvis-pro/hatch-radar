/** posts 表的行结构 */
export interface PostRow {
  /** 帖子唯一 ID；Reddit 为 base36，HN 格式 `hn_{id}`，RSS 格式 `rss_{sha1前16位}` */
  id: string;
  /** 数据来源标识：`'reddit'` | `'hackernews'` | `'rss'` */
  source: string;
  /** 版块/频道名称；Reddit 为版块名（不含 r/），其他源为自定义频道标识 */
  subreddit: string;
  title: string;
  /** 发帖人用户名；账号已删除时为 null */
  author: string | null;
  /** 正文内容；外链帖或无正文时为空字符串 */
  selftext: string;
  /** 外链或来源 URL；自发帖可能为 null */
  url: string | null;
  /** 固定链接；Reddit 为相对路径，HN/RSS 为完整 URL */
  permalink: string | null;
  score: number;
  /** 评论总数（含所有层级） */
  num_comments: number;
  /** 发帖 Unix 时间戳（秒） */
  created_utc: number;
  /** 最近一次抓取 Unix 时间戳（秒） */
  fetched_at: number;
  /** 评论回捞阶段：0=未回捞，1=已完成 6h 回捞，2=已完成 12h 回捞；RSS 帖子直接为 2 */
  comment_pass: number;
  /** 最近一次评论回捞 Unix 时间戳（秒）；从未回捞时为 null */
  comments_fetched_at: number | null;
  /** AI 分析完成 Unix 时间戳（秒）；尚未分析时为 null */
  analyzed_at: number | null;
  /** 已尝试 AI 分析的次数；达到 3 次后不再重试 */
  analyze_attempts: number;
}
