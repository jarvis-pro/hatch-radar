/** HackerNews 分区抓取配置 */
export interface HnSection {
  /** HN Firebase REST API 端点名 */
  endpoint: 'topstories' | 'askstories' | 'showstories';
  /** 写入 `posts.subreddit` 的频道标识符，用于后续过滤与展示 */
  channel: string;
}

/**
 * 需要监控的 HackerNews 分区列表——**仅作首启种子**（SourcesSeeder 写入 sources 表）。
 * 首启后请在 Web 设置页增减，勿改此处（库非空即不再读取本列表）。
 */
export const HN_SECTIONS: HnSection[] = [
  { endpoint: 'askstories', channel: 'ask_hn' },
  { endpoint: 'showstories', channel: 'show_hn' },
  { endpoint: 'topstories', channel: 'hackernews_top' },
];

/** RSS 订阅源配置 */
export interface RssFeed {
  /** 频道标识符，写入 `posts.subreddit` 字段，同时作为 ID 哈希的命名空间前缀 */
  name: string;
  /** RSS feed 的完整 URL */
  url: string;
}

/**
 * 需要监控的 RSS 订阅源列表——**仅作首启种子**（SourcesSeeder 写入 sources 表）。
 * 首启后请在 Web 设置页增减，勿改此处（库非空即不再读取本列表）。
 */
export const RSS_FEEDS: RssFeed[] = [
  { name: 'techcrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'yc_blog', url: 'https://www.ycombinator.com/blog/rss.xml' },
];
