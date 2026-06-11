import type { RssFeed } from '../crawler/rss.js';

export const HN_SECTIONS: Array<{
  endpoint: 'topstories' | 'askstories' | 'showstories';
  channel: string;
}> = [
  { endpoint: 'askstories', channel: 'ask_hn' },
  { endpoint: 'showstories', channel: 'show_hn' },
  { endpoint: 'topstories', channel: 'hackernews_top' },
];

// 按需增减。name 用作频道标识符（同 subreddit 字段）
export const RSS_FEEDS: RssFeed[] = [
  { name: 'techcrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'yc_blog', url: 'https://www.ycombinator.com/blog/rss.xml' },
];
