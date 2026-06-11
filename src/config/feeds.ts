import type { RssFeed } from '../crawler/rss.js';

/**
 * 需要监控的 HackerNews 分区配置。
 * - endpoint：HN Firebase API 端点名
 * - channel：写入 `posts.subreddit` 的频道标识符
 */
export const HN_SECTIONS: Array<{
  endpoint: 'topstories' | 'askstories' | 'showstories';
  channel: string;
}> = [
  { endpoint: 'askstories', channel: 'ask_hn' },
  { endpoint: 'showstories', channel: 'show_hn' },
  { endpoint: 'topstories', channel: 'hackernews_top' },
];

/** 需要监控的 RSS 订阅源列表，按需增减；name 写入 `posts.subreddit` 作为频道标识符 */
export const RSS_FEEDS: RssFeed[] = [
  { name: 'techcrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'yc_blog', url: 'https://www.ycombinator.com/blog/rss.xml' },
];
