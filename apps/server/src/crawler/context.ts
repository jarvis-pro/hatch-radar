import type { CommentRow, PostRow } from '@hatch-radar/shared';

const MAX_TOP_COMMENTS = 20;
const MAX_REPLIES_PER_COMMENT = 3;
const MAX_COMMENT_CHARS = 500;
const MAX_SELFTEXT_CHARS = 4000;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * 将帖子与评论组装为送入 AI 分析的结构化纯文本上下文。
 * - 正文截断至 4000 字符，评论截断至 500 字符/条
 * - 展示得分最高的前 20 条顶层评论及每条最多 3 条回复
 * - Reddit 频道显示为 `r/{name}`，其他来源直接显示频道标识符
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论（所有深度）
 * @returns 多行文本，可直接作为用户消息发送给模型
 */
export function buildContext(post: PostRow, comments: CommentRow[]): string {
  const channel = post.source === 'reddit' ? `r/${post.subreddit}` : post.subreddit;
  const lines: string[] = [
    `标题: ${post.title}`,
    `版块: ${channel}`,
    `作者: ${post.author ?? '[deleted]'}`,
    `发布时间: ${new Date(post.created_utc * 1000).toISOString()}`,
    `点赞: ${post.score} | 评论数: ${post.num_comments}`,
  ];

  if (post.selftext.trim()) {
    lines.push('', '正文:', truncate(post.selftext, MAX_SELFTEXT_CHARS));
  } else if (post.url && !post.url.includes('reddit.com')) {
    lines.push('', `外链: ${post.url}`);
  }

  const topLevel = comments
    .filter((c) => c.depth === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TOP_COMMENTS);

  if (topLevel.length > 0) {
    lines.push(
      '',
      `热门评论（按点赞排序，共 ${comments.length} 条，展示 ${topLevel.length} 条主评论及部分回复）:`,
    );
    for (const comment of topLevel) {
      lines.push(
        `[+${comment.score}] ${comment.author ?? '[deleted]'}: ${truncate(comment.body, MAX_COMMENT_CHARS)}`,
      );
      const replies = comments
        .filter((r) => r.parent_id === comment.id)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_REPLIES_PER_COMMENT);
      for (const reply of replies) {
        lines.push(
          `    ↳ [+${reply.score}] ${reply.author ?? '[deleted]'}: ${truncate(reply.body, MAX_COMMENT_CHARS)}`,
        );
      }
    }
  } else {
    lines.push('', '（暂无评论）');
  }

  return lines.join('\n');
}
