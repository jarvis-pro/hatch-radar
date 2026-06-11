import { createHash } from 'node:crypto';
import Parser from 'rss-parser';

import type { RedditPost } from './reddit.js';

/** RSS 订阅源配置 */
export interface RssFeed {
  /** 频道标识符，写入 `posts.subreddit` 字段，同时作为 ID 哈希的命名空间前缀 */
  name: string;
  /** RSS feed 的完整 URL */
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

/**
 * 抓取一个 RSS feed 并将条目映射为 RedditPost 结构。
 * - 无评论，入库时应设 `initialCommentPass=2` 跳过评论回捞阶段直接进入分析
 * - 正文截断至 2000 字符，HTML 标签被剥除
 * @param feed RSS 源配置
 * @param limit 最多取前 N 条条目，默认 20
 * @returns 映射后的帖子列表，id 格式 `rss_{sha1前16位}`，score / numComments 恒为 0
 */
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
