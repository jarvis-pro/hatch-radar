import { createHash } from 'node:crypto';
import Parser from 'rss-parser';

import type { RedditPost } from './reddit.js';

export interface RssFeed {
  name: string;
  url: string;
}

const parser = new Parser({ timeout: 10_000 });

function rssId(feedName: string, guid: string): string {
  return `rss_${createHash('sha1').update(`${feedName}|${guid}`).digest('hex').slice(0, 16)}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchFeed(feed: RssFeed, limit = 20): Promise<RedditPost[]> {
  const result = await parser.parseURL(feed.url);
  const posts: RedditPost[] = [];
  for (const item of (result.items ?? []).slice(0, limit)) {
    const guid = item.guid || item.link || item.title || '';
    if (!guid || !item.title) continue;
    const raw = item.content || item.contentSnippet || '';
    posts.push({
      id: rssId(feed.name, guid),
      subreddit: feed.name,
      title: item.title,
      author: item.creator || '',
      selftext: stripHtml(raw).slice(0, 2000),
      url: item.link ?? '',
      permalink: item.link ?? '',
      score: 0,
      numComments: 0,
      createdUtc: item.isoDate
        ? Math.floor(new Date(item.isoDate).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
      stickied: false,
    });
  }
  return posts;
}
