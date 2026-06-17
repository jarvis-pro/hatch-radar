import type { CommentRow, PostRow } from '@hatch-radar/shared';

/** 上下文中渲染的评论节点总预算（全局，跨整棵树）：到顶即停，避免单帖 token 失控 */
const MAX_COMMENTS_RENDERED = 80;
/** 纳入渲染的顶层评论（楼）数上限，按得分取前 N 楼 */
const MAX_TOP_THREADS = 25;
/** 渲染下钻的最大深度（0 为顶层）；超出则不再展开该子树 */
const MAX_DEPTH_RENDERED = 6;
const MAX_COMMENT_CHARS = 500;
const MAX_SELFTEXT_CHARS = 4000;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * 命名 HTML 实体 → 对应字符。与 crawler 的 `decodeEntities` 保持同一张表，但**刻意不**引入对
 * @hatch-radar/crawler 的依赖——两者是同级能力包，为一个纯函数反向耦合不值当。
 * 未收录的命名实体一律原样保留，绝不臆测，避免破坏正文。
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // 刻意映射为普通空格：下游文本分析比不间断空格（U+00A0）更省心
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
 * 解码 HTML 实体，覆盖命名实体（{@link NAMED_ENTITIES}）、十进制 `&#NN;`、十六进制 `&#xHH;`（x 大小写均可）
 * 三种形式，**单次扫描**（每个 `&…;` 仅消费一次，故双重编码 `&amp;#x2F;` 只解一层 → `&#x2F;`，不过度解码）。
 * 无法识别的命名实体、越界 / 非法码点一律原样保留。
 *
 * 这是一层**防御性再解码**：采集层历史上曾把实体原样入库（参见 crawler `decodeHtml` 的修复与 HN 回填脚本），
 * 故在送 AI 前对已落库文本再解一次，避免 `&#x2F;` 之类残留实体被当作字面文本进入分析上下文。
 *
 * 仅解码实体，**不**剥离标签——本函数作用于**已入库的纯文本**，正文里的字面 `<...>`（由 `&lt;`/`&gt;`
 * 解码而来）必须原样保留（与 HN 回填脚本同一约束）；对其重跑剥标签会把合法尖括号误删。
 */
export function decodeHtmlEntities(text: string): string {
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

function normalizeBody(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/(https?:\/\/\S+?) \(\1\)/g, '$1') // 完整重复 URL: url (url) → url
    .replace(/(https?:\/\/\S+?)\.\.\. \((https?:\/\/\S+)\)/g, '$2') // HN 截断 URL: short... (full) → full
    .replace(/\n+/g, ' '); // body 内换行全部压成空格，保证每条评论单行输出
}

/**
 * 将帖子与评论组装为送入 AI 分析的结构化纯文本上下文。
 *
 * 评论按**完整楼层树**渲染（不再只取顶层+直接回复），保证深层讨论对模型可见：
 * - **选取**按得分（前 {@link MAX_TOP_THREADS} 楼 + 全局 {@link MAX_COMMENTS_RENDERED} 节点预算内高信号优先入选），
 *   **渲染**按发布时间正序（每层兄弟从早到晚），让模型读到的讨论保持先后顺序；缩进体现层级
 * - 受全局节点预算 {@link MAX_COMMENTS_RENDERED} 与深度 {@link MAX_DEPTH_RENDERED} 约束；
 *   正文截断 4000 字符 / 单条评论截断 500 字符
 * - 评论标题行**显式标注**「来源标称 / 本地已抓 / 展示」三个口径；本地少于标称、或展示少于已抓时
 *   明示「可能不完整」，避免模型把残缺上下文误判为全量讨论
 * - Reddit 频道显示为 `r/{name}`，其他来源直接显示频道标识符
 * @param post 目标帖子行
 * @param comments 该帖子的全部已抓评论（所有深度）
 * @returns 多行文本，可直接作为用户消息发送给模型
 */
export function buildContext(post: PostRow, comments: CommentRow[]): string {
  const channel = post.source === 'reddit' ? `r/${post.subreddit}` : post.subreddit;
  const link =
    post.source === 'reddit' && post.permalink
      ? `https://www.reddit.com${post.permalink}`
      : (post.permalink ?? post.url ?? null);
  const lines: string[] = [
    `标题: ${post.title}`,
    `版块: ${channel}`,
    `作者: ${post.author ?? '[deleted]'}`,
    `发布时间: ${new Date(post.created_utc * 1000).toISOString()}`,
    `点赞: ${post.score} | 评论数: ${post.num_comments}`,
    ...(link ? [`链接: ${link}`] : []),
  ];

  if (post.selftext.trim()) {
    lines.push('', '正文:', truncate(normalizeBody(post.selftext), MAX_SELFTEXT_CHARS));
  } else if (post.url && !post.url.includes('reddit.com')) {
    lines.push('', `外链: ${post.url}`);
  }

  if (comments.length === 0) {
    lines.push('', '（暂无评论）');
    return lines.join('\n');
  }

  const ids = new Set(comments.map((c) => c.id));
  // 顶层 = depth 0，或父评论缺失（父被删/未抓）的孤儿——后者也当作一楼，避免整条子树被埋没
  const isRoot = (c: CommentRow): boolean =>
    c.depth === 0 || c.parent_id === null || !ids.has(c.parent_id);

  // ── 选取阶段（按得分）：决定哪些评论进预算——最有信号的优先入选，避免被 80 条 / 25 楼上限截断丢弃。
  const childrenByScore = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (c.parent_id === null) continue;
    const bucket = childrenByScore.get(c.parent_id);
    if (bucket) bucket.push(c);
    else childrenByScore.set(c.parent_id, [c]);
  }
  for (const bucket of childrenByScore.values()) bucket.sort((a, b) => b.score - a.score);
  const topThreads = comments
    .filter(isRoot)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TOP_THREADS);
  const selected = new Set<string>();
  const select = (comment: CommentRow, depth: number): void => {
    if (selected.size >= MAX_COMMENTS_RENDERED) return;
    selected.add(comment.id);
    if (depth >= MAX_DEPTH_RENDERED) return;
    for (const child of childrenByScore.get(comment.id) ?? []) {
      if (selected.size >= MAX_COMMENTS_RENDERED) break;
      select(child, depth + 1);
    }
  };
  for (const root of topThreads) {
    if (selected.size >= MAX_COMMENTS_RENDERED) break;
    select(root, 0);
  }

  // ── 渲染阶段（按时间正序）：只输出已选评论，每层兄弟按发布时间从早到晚，
  // 让模型读到的讨论保持先后顺序；「选哪些」由上面的得分阶段决定，高信号不丢。
  const childrenByTime = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (!selected.has(c.id) || c.parent_id === null || !selected.has(c.parent_id)) continue;
    const bucket = childrenByTime.get(c.parent_id);
    if (bucket) bucket.push(c);
    else childrenByTime.set(c.parent_id, [c]);
  }
  for (const bucket of childrenByTime.values())
    bucket.sort((a, b) => a.created_utc - b.created_utc);
  const rootsByTime = comments
    .filter((c) => selected.has(c.id) && isRoot(c))
    .sort((a, b) => a.created_utc - b.created_utc);

  const commentLines: string[] = [];
  const renderNode = (comment: CommentRow, depth: number): void => {
    const indent = depth === 0 ? '' : `${'    '.repeat(depth)}↳ `;
    const scoreTag = comment.score > 0 ? `[赞+${comment.score}] ` : '';
    commentLines.push(
      `${indent}${scoreTag}${comment.author ?? '[deleted]'}: ${truncate(normalizeBody(comment.body), MAX_COMMENT_CHARS)}`,
    );
    for (const child of childrenByTime.get(comment.id) ?? []) renderNode(child, depth + 1);
  };
  for (const root of rootsByTime) renderNode(root, 0);

  const rendered = selected.size;

  // 标题行明示三个口径 + 不完整提示（来源标称多于本地已抓 → 抓取阶段就不全）
  const incomplete = post.num_comments > comments.length;
  const headerBits = incomplete ? [`来源标称 ${post.num_comments} 条`] : [];
  headerBits.push(`本地已抓 ${comments.length} 条`, `按楼层展示 ${rendered} 条`);
  lines.push(
    '',
    `评论（${headerBits.join('，')}${incomplete ? '，可能不完整' : ''}）:`,
    ...commentLines,
  );
  if (rendered < comments.length) {
    lines.push(`…（另有 ${comments.length - rendered} 条已抓评论受上下文长度上限未展示）`);
  }

  return lines.join('\n');
}
