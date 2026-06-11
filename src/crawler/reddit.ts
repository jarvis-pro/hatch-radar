import { log } from '../log.js';
import type { TokenBucketQueue } from './queue.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const MAX_ATTEMPTS = 5;

export interface RedditConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  author: string;
  selftext: string;
  url: string;
  permalink: string;
  score: number;
  numComments: number;
  createdUtc: number;
  stickied: boolean;
}

export interface RedditComment {
  id: string;
  parentId: string | null;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  depth: number;
}

interface ListingResponse {
  data?: { children?: Array<{ kind: string; data: Record<string, unknown> }> };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapPost(d: Record<string, unknown>, fallbackSubreddit: string): RedditPost {
  return {
    id: String(d.id ?? ''),
    subreddit: String(d.subreddit ?? fallbackSubreddit),
    title: String(d.title ?? ''),
    author: String(d.author ?? '[deleted]'),
    selftext: String(d.selftext ?? ''),
    url: String(d.url ?? ''),
    permalink: String(d.permalink ?? ''),
    score: Number(d.score ?? 0),
    numComments: Number(d.num_comments ?? 0),
    createdUtc: Math.floor(Number(d.created_utc ?? 0)),
    stickied: Boolean(d.stickied),
  };
}

export class RedditClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly queue: TokenBucketQueue,
    private readonly cfg: RedditConfig,
  ) {}

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await this.queue.schedule(() =>
      fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.cfg.userAgent,
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: this.cfg.username,
          password: this.cfg.password,
        }),
      }),
    );
    if (!res.ok) throw new Error(`Reddit OAuth 认证失败: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token)
      throw new Error('Reddit OAuth 认证失败：响应中没有 access_token，请检查账号与应用配置');
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    };
    return data.access_token;
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    return this.fetchToken();
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(API_BASE + path);
    url.searchParams.set('raw_json', '1');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const token = await this.ensureToken();
      const res = await this.queue.schedule(() =>
        fetch(url, {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': this.cfg.userAgent },
        }),
      );
      if (res.ok) return (await res.json()) as T;

      if (res.status === 401) {
        this.token = null;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 60_000);
        if (res.status === 429) this.queue.pause(delay);
        log.warn(
          `Reddit ${res.status}，${Math.round(delay / 1000)}s 后重试（${attempt}/${MAX_ATTEMPTS}）: ${path}`,
        );
        await sleep(delay + Math.floor(Math.random() * 250));
        continue;
      }
      throw new Error(`Reddit GET ${path} 失败: ${res.status} ${await res.text()}`);
    }
    throw new Error(`Reddit GET ${path}: 重试 ${MAX_ATTEMPTS} 次后仍失败`);
  }

  /** 抓取版块 hot / new 列表，过滤置顶帖 */
  async fetchListing(subreddit: string, sort: 'hot' | 'new', limit = 25): Promise<RedditPost[]> {
    const data = await this.get<ListingResponse>(`/r/${subreddit}/${sort}`, { limit });
    return (data.data?.children ?? [])
      .filter((child) => child.kind === 't3')
      .map((child) => mapPost(child.data, subreddit))
      .filter((post) => post.id && !post.stickied);
  }

  /** 抓取帖子评论树（top 排序，最多两层），拍平返回 */
  async fetchComments(subreddit: string, postId: string, limit = 100): Promise<RedditComment[]> {
    const data = await this.get<ListingResponse[]>(`/r/${subreddit}/comments/${postId}`, {
      limit,
      depth: 2,
      sort: 'top',
    });
    const out: RedditComment[] = [];
    const walk = (
      children: Array<{ kind: string; data: Record<string, unknown> }>,
      depth: number,
      parentId: string | null,
    ) => {
      for (const child of children) {
        if (child.kind !== 't1') continue; // 跳过 "more" 等占位节点
        const d = child.data;
        const body = String(d.body ?? '');
        out.push({
          id: String(d.id ?? ''),
          parentId,
          author: String(d.author ?? '[deleted]'),
          body,
          score: Number(d.score ?? 0),
          createdUtc: Math.floor(Number(d.created_utc ?? 0)),
          depth,
        });
        const replies = d.replies as ListingResponse | '' | undefined;
        if (replies && typeof replies === 'object' && depth < 2) {
          walk(replies.data?.children ?? [], depth + 1, String(d.id ?? ''));
        }
      }
    };
    walk(data[1]?.data?.children ?? [], 0, null);
    return out.filter((c) => c.id && c.body && c.body !== '[deleted]' && c.body !== '[removed]');
  }
}
