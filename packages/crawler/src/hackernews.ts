import type { CommentFetchResult, RedditComment, RedditPost } from './reddit';

const API_BASE = 'https://hacker-news.firebaseio.com/v0';
const CONCURRENT = 10;
/**
 * 单帖评论抓取的总量预算（节点数上限）。
 * - 同时充当「礼貌限速」：递归是逐层批量（每批 {@link CONCURRENT} 并发）抓取，本预算上限即整棵树的请求数上限，
 *   避免超大帖（数千评论）打爆 Firebase。命中后将余下评论计入 dropped。
 */
const HN_MAX_COMMENTS = 500;
/** 单帖评论抓取的最大下钻深度（0 为顶层）；超出此深度的子树计入 dropped */
const HN_MAX_DEPTH = 8;

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

/**
 * 命名 HTML 实体 → 对应字符。
 *
 * HN Firebase API 实际只产出 `&amp; &lt; &gt; &quot;`（撇号 / 斜杠走十六进制 `&#x27;` / `&#x2F;`，
 * 由数字实体通道解码），此处额外收录少量常见排版标点实体，兼容潜在的其他富文本来源。
 * 未收录的命名实体一律原样保留，绝不臆测，避免破坏正文。
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // 刻意映射为普通空格（沿用旧实现）：下游文本分析 / 导出比不间断空格（U+00A0）更省心
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/**
 * 解码字符串中的 HTML 实体，覆盖三种形式：
 * - 命名实体（{@link NAMED_ENTITIES}，如 `&amp;` → `&`）；
 * - 十进制数字实体 `&#NN;`（如 `&#39;` → `'`）；
 * - 十六进制数字实体 `&#xHH;`（x 大小写均可，如 `&#x2F;` → `/`、`&#x27;` → `'`）。
 *
 * **单次扫描**（一条正则一次替换，每个 `&…;` 仅消费一次）：故双重编码如 `&amp;#x2F;` 只解一层
 * → `&#x2F;`（即用户字面输入的文本），不会过度解码成 `/`。无法识别的命名实体、越界 / 非法码点原样保留。
 *
 * 注意：仅解码实体，**不**碰 HTML 标签——存量数据回填只应跑本函数。标签已在首次抓取时被
 * {@link decodeHtml} 剥离，对已入库文本重跑 {@link decodeHtml} 会把正文里合法的 `<...>`（由 `&lt;`/`&gt;`
 * 解码而来）当标签误删。
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string): string => {
      if (body.startsWith('#')) {
        const codePoint =
          body[1] === 'x' || body[1] === 'X'
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        // 越界 / 非法码点（NaN、负数、超出 Unicode 上限）原样保留，避免抛错或产生替换符 U+FFFD
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

/**
 * 将 HN Firebase API 返回的 HTML 富文本转为入库用纯文本。
 *
 * **顺序固定为「先标签后实体」**：先结构化处理标签（`<p>` → 空行、`<br>` → 换行、
 * `<a href>` → `文本 (链接)`、剥除其余标签），再 {@link decodeEntities} 解码 HTML 实体。
 * 如此用户正文里被转义的 `&lt;b&gt;` 会作为字面文本 `<b>` 保留，而非在标签剥离阶段被误删。最后 trim。
 */
export function decodeHtml(html: string): string {
  const withoutTags = html
    .replace(/<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withoutTags).trim();
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

/**
 * 逐层（BFS）递归抓取 HN 评论树并拍平（纯遍历逻辑，fetch 经参数注入，便于单测无网络）。
 *
 * - 按层批量抓取：每层一次性把该层所有节点交给 `fetchItems`（内部 {@link CONCURRENT} 并发），depth 精确
 * - 受总量（`maxComments`）与深度（`maxDepth`）双上限约束，命中任一上限即停止下钻
 * - `dropped` 仅在**确实因上限截断**时给出（= 帖子标称 descendants − 已抓数；含源端已删除评论，故为不完整程度的近似）；
 *   若整棵树在上限内抓全则为 0（descendants 与已抓数之差仅为已删/dead，不算「被我们丢弃」）
 * @param root 帖子的顶层评论 id 列表与标称后代总数（descendants）
 * @param fetchItems 批量取 item 的函数（已过滤 deleted/dead），通常为 {@link fetchBatch}
 * @param opts 总量 / 深度上限，缺省取 {@link HN_MAX_COMMENTS} / {@link HN_MAX_DEPTH}
 * @returns 拍平评论（顶层 depth=0 逐层 +1，score 恒 0）+ 截断丢弃计数
 */
export async function collectHnComments(
  root: { kids: number[]; descendants: number },
  fetchItems: (ids: number[]) => Promise<HNItem[]>,
  opts: { maxComments?: number; maxDepth?: number } = {},
): Promise<CommentFetchResult> {
  const maxComments = opts.maxComments ?? HN_MAX_COMMENTS;
  const maxDepth = opts.maxDepth ?? HN_MAX_DEPTH;
  const out: RedditComment[] = [];
  let frontier: Array<{ id: number; parentId: string | null }> = root.kids.map((id) => ({
    id,
    parentId: null,
  }));
  let hitCap = false;

  for (let depth = 0; frontier.length > 0; depth++) {
    if (depth > maxDepth) {
      hitCap = true; // 还有未抓的更深层级
      break;
    }
    const room = maxComments - out.length;
    if (room <= 0) {
      hitCap = true;
      break;
    }
    // 总量预算不足以容纳整层时，只取放得下的部分，余下计为截断
    const level = frontier.length > room ? frontier.slice(0, room) : frontier;
    if (level.length < frontier.length) hitCap = true;

    const parentById = new Map(level.map((f) => [f.id, f.parentId]));
    const items = await fetchItems(level.map((f) => f.id));
    const next: Array<{ id: number; parentId: string | null }> = [];
    for (const item of items) {
      if (!item.text || !item.by) continue;
      const cid = `hn_${item.id}`;
      out.push({
        id: cid,
        parentId: parentById.get(item.id) ?? null,
        author: item.by,
        body: decodeHtml(item.text),
        score: 0,
        createdUtc: item.time ?? 0,
        depth,
      });
      for (const kid of item.kids ?? []) next.push({ id: kid, parentId: cid });
    }
    frontier = next;
  }

  const dropped = hitCap ? Math.max(0, (root.descendants ?? 0) - out.length) : 0;
  return { comments: out, dropped };
}

/**
 * HackerNews Firebase REST API 客户端（无需鉴权）。
 * - 并发批量抓取，每批最多 10 个并发请求
 * - 评论分数恒为 0（HN API 不暴露评论评分）
 * - HTML 实体与标签自动解码为纯文本
 */
export class HackerNewsClient {
  private async fetchIds(endpoint: string): Promise<number[]> {
    const res = await fetch(`${API_BASE}/${endpoint}.json`);
    if (!res.ok) throw new Error(`HN API 失败: ${res.status} GET /${endpoint}`);
    return (await res.json()) as number[];
  }

  /**
   * 抓取指定 HN 分区的故事列表。
   * @param endpoint HN Firebase 端点名，决定抓取分区
   * @param channel 写入 `posts.subreddit` 的频道标识符（如 ask_hn / hackernews_top）
   * @param limit 最多取前 N 条故事 ID；实际返回数可能更少（deleted / dead 条目被过滤）
   * @returns 映射为 RedditPost 结构的故事列表，id 格式为 `hn_{numericId}`
   */
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

  /**
   * 抓取 HN 帖子的完整评论树（逐层递归下钻），拍平返回。
   *
   * - 递归抓取所有层级，受总量 / 深度上限约束（{@link HN_MAX_COMMENTS} / {@link HN_MAX_DEPTH}），
   *   不再每节点硬切前 5 条回复 / 仅两层；尽可能把帖子的 `descendants` 抓全
   * - 命中上限时余下评论计入 `dropped`（见 {@link collectHnComments}），使「不完整」可观测
   * @param hnPostId DB 中存储的帖子 ID，格式 `hn_{numericId}`
   * @param limit 总评论数上限，默认 {@link HN_MAX_COMMENTS}
   * @returns 拍平评论（顶层 depth=0 逐层 +1，score 恒 0）+ 截断丢弃计数（{@link CommentFetchResult}）
   */
  async fetchComments(hnPostId: string, limit = HN_MAX_COMMENTS): Promise<CommentFetchResult> {
    const numericId = Number(hnPostId.replace('hn_', ''));
    const story = await fetchItem(numericId);
    if (!story?.kids?.length) return { comments: [], dropped: 0 };
    return collectHnComments(
      { kids: story.kids, descendants: story.descendants ?? 0 },
      fetchBatch,
      { maxComments: limit },
    );
  }
}
