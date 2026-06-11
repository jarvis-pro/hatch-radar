import type { RedditComment, RedditPost } from './reddit.js';

const API_BASE = 'https://hacker-news.firebaseio.com/v0';
const CONCURRENT = 10;

interface HNItem {
  id: number;
  type: string;
  by?: string;
  time?: number;
  title?: string;
  text?: string;
  url?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    const res = await fetch(`${API_BASE}/item/${id}.json`);
    if (!res.ok) return null;
    return (await res.json()) as HNItem | null;
  } catch {
    return null;
  }
}

function decodeHtml(html: string): string {
  return html
    .replace(/<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function fetchBatch(ids: number[]): Promise<HNItem[]> {
  const out: HNItem[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENT) {
    const chunk = ids.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(chunk.map(fetchItem));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && !r.value.deleted && !r.value.dead) {
        out.push(r.value);
      }
    }
  }
  return out;
}

export class HackerNewsClient {
  private async fetchIds(endpoint: string): Promise<number[]> {
    const res = await fetch(`${API_BASE}/${endpoint}.json`);
    if (!res.ok) throw new Error(`HN API 失败: ${res.status} GET /${endpoint}`);
    return (await res.json()) as number[];
  }

  async fetchStories(
    endpoint: 'topstories' | 'askstories' | 'showstories',
    channel: string,
    limit: number,
  ): Promise<RedditPost[]> {
    const ids = await this.fetchIds(endpoint);
    const items = await fetchBatch(ids.slice(0, limit));
    return items
      .filter((item) => item.title && item.type !== 'comment')
      .map((item) => ({
        id: `hn_${item.id}`,
        subreddit: channel,
        title: item.title ?? '',
        author: item.by ?? '[deleted]',
        selftext: item.text ? decodeHtml(item.text) : '',
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        permalink: `https://news.ycombinator.com/item?id=${item.id}`,
        score: item.score ?? 0,
        numComments: item.descendants ?? 0,
        createdUtc: item.time ?? 0,
        stickied: false,
      }));
  }

  async fetchComments(hnPostId: string, limit = 80): Promise<RedditComment[]> {
    const numericId = Number(hnPostId.replace('hn_', ''));
    const story = await fetchItem(numericId);
    if (!story?.kids?.length) return [];

    const out: RedditComment[] = [];
    const topLevel = await fetchBatch(story.kids.slice(0, 50));

    for (const item of topLevel) {
      if (!item.text || !item.by) continue;
      out.push({
        id: `hn_${item.id}`,
        parentId: null,
        author: item.by,
        body: decodeHtml(item.text),
        score: 0,
        createdUtc: item.time ?? 0,
        depth: 0,
      });
      if (item.kids?.length && out.length < limit) {
        const replies = await fetchBatch(item.kids.slice(0, 5));
        for (const reply of replies) {
          if (!reply.text || !reply.by) continue;
          out.push({
            id: `hn_${reply.id}`,
            parentId: `hn_${item.id}`,
            author: reply.by,
            body: decodeHtml(reply.text),
            score: 0,
            createdUtc: reply.time ?? 0,
            depth: 1,
          });
        }
      }
      if (out.length >= limit) break;
    }
    return out;
  }
}
