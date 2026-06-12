import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import {
  DDL,
  EXPORT_FORMAT_VERSION,
  EXPORT_META_DDL,
  type CommentRow,
  type ExportBatch,
  type ExportFilter,
  type InsightRow,
  type PostRow,
} from '@hatch-radar/shared';
import { getDb } from '../db/schema';
import { nowSec } from '../db/utils';

/**
 * 按条件从主库筛出一个导出批次。
 *
 * 「有效数据」基线：洞察必须有实质信号（痛点或机会非空），在此之上叠加可选筛选。
 * 关联帖子已被 30 天归档清理时仅导出洞察本身（post_id 为软引用，移动端按缺失处理）。
 * @param filter 批次筛选条件
 */
export function collectExportBatch(filter: ExportFilter): ExportBatch {
  const db = getDb();
  const clauses = ['(json_array_length(pain_points) > 0 OR json_array_length(opportunities) > 0)'];
  const params: unknown[] = [];
  if (filter.since) {
    clauses.push('created_at > ?');
    params.push(filter.since);
  }
  if (filter.minIntensity === 'HIGH') clauses.push(`intensity = 'HIGH'`);
  if (filter.minIntensity === 'MEDIUM') clauses.push(`intensity IN ('HIGH', 'MEDIUM')`);
  if (filter.subreddit) {
    clauses.push('subreddit = ? COLLATE NOCASE');
    params.push(filter.subreddit);
  }
  const limitSql = filter.limit ? ' LIMIT ?' : '';
  if (filter.limit) params.push(filter.limit);

  const insights = db
    .prepare(
      `SELECT * FROM insights WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC${limitSql}`,
    )
    .all(...params) as InsightRow[];

  const postStmt = db.prepare(`SELECT * FROM posts WHERE id = ?`);
  const commentStmt = db.prepare(
    `SELECT * FROM comments WHERE post_id = ? ORDER BY created_utc, id`,
  );
  const posts: PostRow[] = [];
  const comments: CommentRow[] = [];
  for (const insight of insights) {
    const post = postStmt.get(insight.post_id) as PostRow | undefined;
    if (!post) continue;
    posts.push(post);
    comments.push(...(commentStmt.all(post.id) as CommentRow[]));
  }

  return {
    meta: {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: nowSec(),
      filter,
      counts: { insights: insights.length, posts: posts.length, comments: comments.length },
    },
    insights,
    posts,
    comments,
  };
}

/** 确保目标文件所在目录存在，返回绝对路径 */
function prepareTarget(file: string): string {
  const abs = resolve(file);
  mkdirSync(dirname(abs), { recursive: true });
  return abs;
}

/**
 * 把批次写为 .json 文件。
 * @returns 写入的绝对路径
 */
export function writeBatchJson(batch: ExportBatch, file: string): string {
  const abs = prepareTarget(file);
  writeFileSync(abs, JSON.stringify(batch, null, 2), 'utf8');
  return abs;
}

/**
 * 把批次写为独立 .sqlite 文件：共享 DDL 建表 + export_meta 元信息。
 *
 * 刻意不开 WAL：默认 journal 模式产出单文件，方便 AirDrop 传输与移动端 ATTACH 合并
 * （WAL 会伴生 -wal/-shm 两个文件，拷贝不全会丢数据）。同名文件直接覆盖。
 * @returns 写入的绝对路径
 */
export function writeBatchSqlite(batch: ExportBatch, file: string): string {
  const abs = prepareTarget(file);
  rmSync(abs, { force: true });
  const out = new Database(abs);
  try {
    out.exec(DDL);
    out.exec(EXPORT_META_DDL);
    const insertMeta = out.prepare(`INSERT INTO export_meta (key, value) VALUES (?, ?)`);
    const insertInsight = out.prepare(
      `INSERT INTO insights (id, post_id, source, subreddit, post_title, permalink, model, intensity, pain_points, opportunities, tags, created_at)
       VALUES (@id, @post_id, @source, @subreddit, @post_title, @permalink, @model, @intensity, @pain_points, @opportunities, @tags, @created_at)`,
    );
    const insertPost = out.prepare(
      `INSERT INTO posts (id, source, subreddit, title, author, selftext, url, permalink, score, num_comments, created_utc, fetched_at, comment_pass, comments_fetched_at, analyzed_at, analyze_attempts)
       VALUES (@id, @source, @subreddit, @title, @author, @selftext, @url, @permalink, @score, @num_comments, @created_utc, @fetched_at, @comment_pass, @comments_fetched_at, @analyzed_at, @analyze_attempts)`,
    );
    const insertComment = out.prepare(
      `INSERT INTO comments (id, post_id, parent_id, author, body, score, depth, created_utc, fetched_at)
       VALUES (@id, @post_id, @parent_id, @author, @body, @score, @depth, @created_utc, @fetched_at)`,
    );
    out.transaction(() => {
      insertMeta.run('format_version', String(batch.meta.formatVersion));
      insertMeta.run('exported_at', String(batch.meta.exportedAt));
      insertMeta.run('filter', JSON.stringify(batch.meta.filter));
      insertMeta.run('counts', JSON.stringify(batch.meta.counts));
      for (const row of batch.insights) insertInsight.run(row);
      for (const row of batch.posts) insertPost.run(row);
      for (const row of batch.comments) insertComment.run(row);
    })();
  } finally {
    out.close();
  }
  return abs;
}

/** 默认导出文件名：batch-YYYYMMDD-HHmmss.{ext}（本地时区） */
export function defaultExportName(ext: 'json' | 'sqlite', at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `batch-${stamp}.${ext}`;
}
