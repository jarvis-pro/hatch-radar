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
  /** 评论回捞标记：0=未抓评论，≥1=已抓过（即时抓取后置位；RSS 帖子直接为 2 表示无需评论） */
  comment_pass: number;
  /** 最近一次评论回捞 Unix 时间戳（秒）；从未回捞时为 null */
  comments_fetched_at: number | null;
  /** 评论快照内容最近变更 Unix 时间戳（秒）；diff 得出，从未变更/未抓时为 null */
  comments_changed_at: number | null;
  /** 导出冻结 Unix 时间戳（秒）；置位时暂停评论 refresh，NULL=未冻结 */
  export_locked_at: number | null;
  /** AI 分析完成 Unix 时间戳（秒）；尚未分析时为 null（仅 anthropic/deepseek 自动模式使用） */
  analyzed_at: number | null;
  /** 已尝试 AI 分析的次数；达到 3 次后不再重试 */
  analyze_attempts: number;
  /** 标题源文本的 sha256（十六进制）；按内容寻址译文 / 判定未翻译，空标题为 null */
  title_hash: string | null;
  /** 正文源文本的 sha256；链接帖空正文为 null（无需翻译） */
  selftext_hash: string | null;
  /** 复查：连续未变次数（驱动指数退避）；命中变化归零 */
  recheck_misses: number;
  /** 复查：下次有资格被复查的 sweep 序号（≤ 当前 sweep 即到期） */
  recheck_due_sweep: number;
  /** 最近一次复查 Unix 时间戳（秒）；从未复查为 null */
  last_rechecked_at: number | null;
}
