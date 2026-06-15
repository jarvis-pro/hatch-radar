/**
 * SourcesSeeder 的种子数据：默认监控的来源清单（与 sources.seeder.ts 同处，就近管理）。
 *
 * **仅作首启种子**——SourcesSeeder 在 sources 表为空时把这些写入；表非空即不再读取本文件。
 * 首启之后请在 Web 设置页增减来源，勿改此处（改了也不影响已播种的库）。
 * 这里只放「值」；类型/抓取逻辑属 crawler 运行期，分别在 crawler/ 下。
 */

/** HackerNews 分区抓取配置 */
export interface HnSection {
  /** HN Firebase REST API 端点名 */
  endpoint: 'topstories' | 'askstories' | 'showstories';
  /** 写入 `posts.subreddit` 的频道标识符，用于后续过滤与展示 */
  channel: string;
}

/** RSS 订阅源配置 */
export interface RssFeed {
  /** 频道标识符，写入 `posts.subreddit`，同时作为 ID 哈希的命名空间前缀 */
  name: string;
  /** RSS feed 的完整 URL */
  url: string;
}

/** 默认监控的 Reddit 版块列表 */
export const SUBREDDITS = [
  // 通用创业 / 产品
  'entrepreneur',
  'startups',
  'indiehackers',
  'SaaS',

  // 需求直接表达
  'SomebodyMakeThis',
  'AppIdeas',

  // 按需补充垂直领域
  // "marketing",
  // "ecommerce",
];

/** 默认监控的 HackerNews 分区列表 */
export const HN_SECTIONS: HnSection[] = [
  { endpoint: 'askstories', channel: 'ask_hn' },
  { endpoint: 'showstories', channel: 'show_hn' },
  { endpoint: 'topstories', channel: 'hackernews_top' },
];

/** 默认监控的 RSS 订阅源列表 */
export const RSS_FEEDS: RssFeed[] = [
  { name: 'techcrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'yc_blog', url: 'https://www.ycombinator.com/blog/rss.xml' },
];
