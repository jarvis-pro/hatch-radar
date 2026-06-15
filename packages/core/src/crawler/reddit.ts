import { logger } from '@hatch-radar/kernel';
import type { TokenBucketQueue } from './queue';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const MAX_ATTEMPTS = 5;

/** Reddit OAuth（script 类型）应用凭据 */
export interface RedditConfig {
  /** OAuth 应用的 Client ID */
  clientId: string;
  /** OAuth 应用的 Client Secret */
  clientSecret: string;
  /** 用于 script 类型授权的账号用户名 */
  username: string;
  /** 账号密码 */
  password: string;
  /** 请求头 User-Agent，建议格式：`<app>/<ver> (by /u/<user>)` */
  userAgent: string;
}

/** 帖子数据的通用结构，供 Reddit / HN / RSS 各客户端统一映射 */
export interface RedditPost {
  /** 帖子唯一 ID；Reddit 格式 `rd_{base36}`，HN 格式 `hn_{id}`，RSS 格式 `rss_{sha1前16位}` */
  id: string;
  /** 版块/频道名称；Reddit 为版块名（不含 r/），其他源为自定义频道标识 */
  subreddit: string;
  /** 帖子标题 */
  title: string;
  /** 发帖人用户名；账号已删除时为 `[deleted]` */
  author: string;
  /** 正文内容；外链帖或无正文时为空字符串 */
  selftext: string;
  /** 外链或来源 URL */
  url: string;
  /** 固定链接；Reddit 为相对路径，HN/RSS 为完整 URL */
  permalink: string;
  /** 帖子得分（赞数减踩数） */
  score: number;
  /** 评论总数（含所有层级） */
  numComments: number;
  /** 发帖 Unix 时间戳（秒） */
  createdUtc: number;
  /** 是否为版主置顶帖；置顶帖在入库前会被过滤 */
  stickied: boolean;
}

/** 评论数据的通用结构，供 Reddit / HN 各客户端统一映射 */
export interface RedditComment {
  /** 评论唯一 ID */
  id: string;
  /** 父评论 ID；顶层评论为 null */
  parentId: string | null;
  /** 评论作者用户名；账号已删除时为 `[deleted]` */
  author: string;
  /** 评论正文；已过滤 [deleted] / [removed] 的评论不入库 */
  body: string;
  /** 点赞数；HN 评论不暴露评分，恒为 0 */
  score: number;
  /** 发评论 Unix 时间戳（秒） */
  createdUtc: number;
  /** 评论深度：0 为顶层，1 为回复，最多回捞 2 层 */
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
    id: `rd_${String(d.id ?? '')}`,
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

/**
 * Reddit REST API（OAuth）客户端。
 * - 自动管理访问令牌的获取与续期（令牌提前 60 秒刷新）
 * - 所有请求经 TokenBucketQueue 限速，遵守 100 次/分钟配额
 * - 429 / 5xx 自动指数退避重试，最多 5 次
 */
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

  /**
   * 连通性测试：尝试用凭据换取一次 OAuth token，成功即视为可用。
   * 供设置页「测试连接」调用；失败（凭据错/被封）直接抛出。
   */
  async testAuth(): Promise<void> {
    await this.fetchToken();
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
        logger.warn(
          `Reddit ${res.status}，${Math.round(delay / 1000)}s 后重试（${attempt}/${MAX_ATTEMPTS}）: ${path}`,
        );
        await sleep(delay + Math.floor(Math.random() * 250));
        continue;
      }
      throw new Error(`Reddit GET ${path} 失败: ${res.status} ${await res.text()}`);
    }
    throw new Error(`Reddit GET ${path}: 重试 ${MAX_ATTEMPTS} 次后仍失败`);
  }

  /**
   * 抓取版块 hot 或 new 列表，自动过滤置顶帖。
   * @param subreddit 版块名称（不含 r/ 前缀）
   * @param sort 排序方式：hot 按热度，new 按时间
   * @param limit 最多返回条数，默认 25
   * @returns 过滤置顶后的帖子列表
   */
  async fetchListing(subreddit: string, sort: 'hot' | 'new', limit = 25): Promise<RedditPost[]> {
    const data = await this.get<ListingResponse>(`/r/${subreddit}/${sort}`, { limit });
    return (data.data?.children ?? [])
      .filter((child) => child.kind === 't3')
      .map((child) => mapPost(child.data, subreddit))
      .filter((post) => post.id && !post.stickied);
  }

  /**
   * 抓取帖子评论树（top 排序，最多两层深度），拍平为列表返回。
   * - 已删除或已移除的评论（body 为 [deleted]/[removed]）不包含在结果中
   * @param subreddit 帖子所属版块名称
   * @param postId Reddit 帖子 ID（base36）
   * @param limit 最多返回的评论数，默认 100
   * @returns 拍平的评论列表，顶层 depth=0，回复 depth=1
   */
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
