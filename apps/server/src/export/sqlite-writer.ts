import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { DDL, EXPORT_META_DDL, type ExportBatch } from '@hatch-radar/shared';

/**
 * 导出产物写入层（**server 端仅存的 better-sqlite3 用途**）。
 *
 * 数据源已是 PG（见 ExportService.collectBatch，jsonb 已 stringify 回 TEXT），此处只负责
 * 把一个已收集好的批次写成标准 .sqlite / .json 文件。mobile 的 ATTACH 合并依赖此格式。
 */

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
      for (const row of batch.posts) {
        // 仅写共享 DDL 含有的 16 列：comments_changed_at / export_locked_at 是 server 私有列，
        // 不在 mobile / 导出 schema 中，显式构造避免向 named 占位符传入多余 key。
        insertPost.run({
          id: row.id,
          source: row.source,
          subreddit: row.subreddit,
          title: row.title,
          author: row.author,
          selftext: row.selftext,
          url: row.url,
          permalink: row.permalink,
          score: row.score,
          num_comments: row.num_comments,
          created_utc: row.created_utc,
          fetched_at: row.fetched_at,
          comment_pass: row.comment_pass,
          comments_fetched_at: row.comments_fetched_at,
          analyzed_at: row.analyzed_at,
          analyze_attempts: row.analyze_attempts,
        });
      }
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
