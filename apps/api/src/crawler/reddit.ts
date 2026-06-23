import { logger } from '@/logger';
import { sleep } from '@/utils/time';
import type { RedditPost, RedditComment } from '@hatch-radar/shared';
import type { TokenBucketQueue } from './queue';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const MAX_ATTEMPTS = 5;
/**
 * 单次评论请求返回的评论数上限。
 * - 仍是**一次** API 请求（占用一个令牌、不加重 100/min 配额）；depth 省略 → Reddit 返回完整嵌套树，
 *   直到累计达 limit 后将其余子树折叠为 `more` 占位节点
 * - 提高此值只增大单次响应体积，不增加请求数；溢出/深层评论的隐藏数由 `more.count` 计入 dropped
 */
const REDDIT_COMMENT_LIMIT = 200;

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

// 通用 ingestion 结构（RedditPost / RedditComment）已迁至 @hatch-radar/shared；
// 此处再导出，保持 '../crawler/reddit' 既有消费者（scheduler 等）不变。
export type { RedditPost, RedditComment };

/** 评论树节点：Reddit listing 的 child（kind 't1'=评论 / 'more'=折叠占位） */
interface ListingChild {
  kind: string;
  data: Record<string, unknown>;
}

interface ListingResponse {
  data?: { children?: ListingChild[] };
}

/**
 * 评论抓取结果：拍平的评论列表 + 被有意丢弃的评论数估计。
 *
 * `dropped > 0` 表示**就当前抓取策略而言**评论不完整：Reddit 来自未展开的 `more` 折叠节点
 * （本项目刻意不调用 /api/morechildren，详见 {@link RedditClient.fetchComments}）；HN 来自深度/总量上限。
 * 供调度层记日志、分析层在送 AI 的上下文中标注「可能不完整」，避免误判为全量。
 */
export interface CommentFetchResult {
  /** 拍平的评论列表（已过滤 [deleted] / [removed]） */
  comments: RedditComment[];
  /** 被有意丢弃、未抓取的评论数估计；0 表示就当前来源策略而言已抓全 */
  dropped: number;
}

/**
 * 将 Reddit 评论 listing 的 children 递归拍平为评论列表（纯函数，便于单测，无网络）。
 * - 完整下钻 API 返回的所有 `t1` 评论层级（不再人为限制两层）
 * - 遇到 `more` 折叠节点：把其 `count`（被折叠隐藏的子/兄弟评论数）累加进 dropped 后跳过——
 *   **不**展开 morechildren（Reddit 官方通道在停用，不为其加重请求投入）
 * - 已删除 / 已移除（body 为 [deleted] / [removed]）的评论从结果中剔除，但不计入 dropped
 * @param children 评论列表接口第二个 listing 的 `data.children`
 * @returns 拍平评论 + 折叠丢弃计数
 */
export function flattenRedditTree(children: ListingChild[]): CommentFetchResult {
  const out: RedditComment[] = [];
  let dropped = 0;
  const walk = (nodes: ListingChild[], depth: number, parentId: string | null): void => {
    for (const child of nodes) {
      if (child.kind === 'more') {
        // more 节点的 count = 被折叠隐藏的评论数（深层子树 + 溢出兄弟），显式计入丢弃
        dropped += Number((child.data as { count?: unknown }).count ?? 0);
        continue;
      }

      if (child.kind !== 't1') {
        continue;
      }

      const d = child.data;
      const id = String(d.id ?? '');
      out.push({
        id,
        parentId,
        author: String(d.author ?? '[deleted]'),
        body: String(d.body ?? ''),
        score: Number(d.score ?? 0),
        createdUtc: Math.floor(Number(d.created_utc ?? 0)),
        depth,
      });
      const replies = d.replies as ListingResponse | '' | undefined;
      if (replies && typeof replies === 'object') {
        walk(replies.data?.children ?? [], depth + 1, id);
      }
    }
  };

  walk(children, 0, null);

  return {
    comments: out.filter((c) => c.id && c.body && c.body !== '[deleted]' && c.body !== '[removed]'),
    dropped,
  };
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
    if (!res.ok) {
      throw new Error(`Reddit OAuth 认证失败: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('Reddit OAuth 认证失败：响应中没有 access_token，请检查账号与应用配置');
    }

    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    };

    return data.access_token;
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) {
      return this.token.value;
    }

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
      if (res.ok) {
        return (await res.json()) as T;
      }

      if (res.status === 401) {
        this.token = null;
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 60_000);
        if (res.status === 429) {
          this.queue.pause(delay);
        }

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
   * 抓取帖子评论树（top 排序）并拍平为列表返回。
   *
   * - **完整嵌套**：省略 depth 参数，让 Reddit 在单次请求内返回尽可能深的评论树；下钻所有返回层级
   *   （顶层 depth=0，逐层 +1），不再人为限制两层
   * - **不展开 more**：超出 `limit` 累计数的子树会被 Reddit 折叠为 `more` 占位节点；本方法刻意**不**调用
   *   /api/morechildren 二次展开——官方 API 通道在停用，深抓留给后续爬虫方案。
   *   被折叠隐藏的评论数计入返回的 `dropped`，使「不完整」可观测而非静默丢弃
   * - 已删除 / 已移除的评论（body 为 [deleted]/[removed]）不包含在结果中
   * @param subreddit 帖子所属版块名称
   * @param postId Reddit 帖子 ID（base36）
   * @param limit 单次请求返回的评论数上限（仍是一次请求，不加重配额），默认 {@link REDDIT_COMMENT_LIMIT}
   * @returns 拍平评论列表 + 折叠丢弃计数（{@link CommentFetchResult}）
   */
  async fetchComments(
    subreddit: string,
    postId: string,
    limit = REDDIT_COMMENT_LIMIT,
  ): Promise<CommentFetchResult> {
    const data = await this.get<ListingResponse[]>(`/r/${subreddit}/comments/${postId}`, {
      limit,
      sort: 'top',
    });

    return flattenRedditTree(data[1]?.data?.children ?? []);
  }
}
