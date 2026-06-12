import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContext } from '../crawler/context';
import type { CommentRow } from '../db/comments';
import type { PostRow } from '../db/posts';
import { INSIGHT_JSON_EXAMPLE, SYSTEM_PROMPT } from './prompt';

/** 将帖子 ID 中可能的非法字符替换为下划线，作为安全文件名 */
function safeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** 拼出帖子的可点击链接（Reddit permalink 为相对路径，补全域名） */
function postLink(post: PostRow): string {
  if (post.source === 'reddit' && post.permalink) {
    return `https://www.reddit.com${post.permalink}`;
  }
  return post.permalink ?? post.url ?? '-';
}

/**
 * 构建单篇帖子的「待分析」Markdown 文档，可整篇粘贴给任意 AI 获取分析结果。
 * - 包含帖子元信息、系统指令、期望的 JSON 输出格式、以及帖子+评论上下文
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论
 * @returns 自包含的 Markdown 文本
 */
export function buildManualAnalysisDoc(post: PostRow, comments: CommentRow[]): string {
  return [
    '<!-- hatch-radar 待分析内容导出（AI_PROVIDER=file 模式产物） -->',
    '<!-- 用法：把本文件完整粘贴给任意 AI（Claude / ChatGPT / DeepSeek 等），它会按「输出格式」返回 JSON 分析结果 -->',
    '',
    '# 帖子信息',
    '',
    `- ID: ${post.id}`,
    `- 来源: ${post.source}`,
    `- 版块: ${post.source === 'reddit' ? `r/${post.subreddit}` : post.subreddit}`,
    `- 链接: ${postLink(post)}`,
    '',
    '# 分析指令',
    '',
    SYSTEM_PROMPT,
    '',
    '# 输出格式',
    '',
    '请严格输出如下结构的 JSON：',
    '',
    '```json',
    INSIGHT_JSON_EXAMPLE,
    '```',
    '',
    '# 待分析内容',
    '',
    buildContext(post, comments),
    '',
  ].join('\n');
}

/**
 * 将单篇帖子的待分析文档写入 `{dir}/{post.id}.md`（同名覆盖，幂等）。
 * @param dir 输出目录，不存在时自动创建
 * @param post 目标帖子行
 * @param comments 该帖子的全部评论
 * @returns 写入的文件绝对/相对路径
 */
export function writeManualAnalysisDoc(dir: string, post: PostRow, comments: CommentRow[]): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safeFileName(post.id)}.md`);
  writeFileSync(file, buildManualAnalysisDoc(post, comments), 'utf8');
  return file;
}
