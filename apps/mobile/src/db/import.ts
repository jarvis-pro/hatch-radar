import {
  EXPORT_FORMAT_VERSION,
  type CommentRow,
  type ExportBatch,
  type InsightRow,
  type PostRow,
} from '@hatch-radar/shared';
import { getDb, setMeta } from './schema';

/** 一次导入的合并结果 */
export interface ImportResult {
  /** 新增的洞察数 */
  added: number;
  /** 已存在并被刷新的洞察数 */
  updated: number;
  posts: number;
  comments: number;
}

/** 帖子 upsert：与服务端 upsertPosts 同语义，但批次来自服务器，分析状态字段一并刷新 */
const UPSERT_POST = `INSERT INTO posts
  (id, source, subreddit, title, author, selftext, url, permalink, score, num_comments, created_utc, fetched_at, comment_pass, comments_fetched_at, analyzed_at, analyze_attempts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title               = excluded.title,
    selftext            = excluded.selftext,
    score               = excluded.score,
    num_comments        = excluded.num_comments,
    fetched_at          = excluded.fetched_at,
    comment_pass        = excluded.comment_pass,
    comments_fetched_at = excluded.comments_fetched_at,
    analyzed_at         = excluded.analyzed_at,
    analyze_attempts    = excluded.analyze_attempts`;

const INSERT_INSIGHT = `INSERT OR REPLACE INTO insights
  (id, post_id, source, subreddit, post_title, permalink, model, intensity, pain_points, opportunities, tags, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_COMMENT = `INSERT OR REPLACE INTO comments
  (id, post_id, parent_id, author, body, score, depth, created_utc, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_TRANSLATION = `INSERT OR REPLACE INTO translations
  (entity_kind, entity_id, text) VALUES (?, ?, ?)`;

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('批次缺少有效的格式版本，可能不是 hatch-radar 导出文件');
  }
  if (version > EXPORT_FORMAT_VERSION) {
    throw new Error(
      `批次格式版本 ${version} 高于 App 支持的 ${EXPORT_FORMAT_VERSION}，请先升级 App`,
    );
  }
}

/** 统计一组洞察 id 中已存在于本地库的数量（导入前调用，用于区分新增/更新） */
function countExistingInsights(ids: number[]): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  let existing = 0;
  for (const id of ids) {
    if (db.getFirstSync<{ n: number }>(`SELECT 1 n FROM insights WHERE id = ?`, [id])) existing++;
  }
  return existing;
}

/**
 * 合并一个 JSON 批次（HTTP 拉取或 .json 文件导入共用）。
 *
 * 幂等：洞察/评论按主键 REPLACE，帖子按 id upsert，重复导入同一批次不产生重复数据。
 * 注意 insights 的 REPLACE 在「同帖重分析产生新 id」时会替换旧行，旧 triage 记录
 * 仍按原 insight_id 保留（软引用，研判数据永不自动删除）。
 */
export function importBatch(batch: ExportBatch): ImportResult {
  if (!batch?.meta || !Array.isArray(batch.insights)) {
    throw new Error('批次结构不完整，可能不是 hatch-radar 导出文件');
  }
  assertVersion(batch.meta.formatVersion);

  const db = getDb();
  const posts = (batch.posts ?? []) as PostRow[];
  const comments = (batch.comments ?? []) as CommentRow[];
  const insights = batch.insights as InsightRow[];
  const existing = countExistingInsights(insights.map((i) => i.id));

  db.withTransactionSync(() => {
    for (const p of posts) {
      db.runSync(UPSERT_POST, [
        p.id,
        p.source,
        p.subreddit,
        p.title,
        p.author,
        p.selftext,
        p.url,
        p.permalink,
        p.score,
        p.num_comments,
        p.created_utc,
        p.fetched_at,
        p.comment_pass,
        p.comments_fetched_at,
        p.analyzed_at,
        p.analyze_attempts,
      ]);
    }
    for (const c of comments) {
      db.runSync(INSERT_COMMENT, [
        c.id,
        c.post_id,
        c.parent_id,
        c.author,
        c.body,
        c.score,
        c.depth,
        c.created_utc,
        c.fetched_at,
      ]);
    }
    for (const i of insights) {
      db.runSync(INSERT_INSIGHT, [
        i.id,
        i.post_id,
        i.source,
        i.subreddit,
        i.post_title,
        i.permalink,
        i.model,
        i.intensity,
        i.pain_points,
        i.opportunities,
        i.tags,
        i.created_at,
      ]);
    }
    // 译文（v2+；v1 批次无此字段 → 跳过）：按实体 id 贴中文，移动端中文优先渲染用
    for (const t of batch.translations ?? []) {
      db.runSync(INSERT_TRANSLATION, [t.entity_kind, t.entity_id, t.text]);
    }
  });

  markImported();
  return {
    added: insights.length - existing,
    updated: existing,
    posts: posts.length,
    comments: comments.length,
  };
}

/**
 * 合并一个 .sqlite 批次文件（AirDrop / 文件 App 导入）。
 * ATTACH 后用 INSERT…SELECT 整表合并，语义与 importBatch 一致。
 * @param path 批次文件的本地绝对路径（不带 file:// 前缀）
 */
export function importSqliteFile(path: string): ImportResult {
  const db = getDb();
  // SQLite 字符串字面量转义：路径来自系统文件选择器，单引号按标准翻倍
  db.execSync(`ATTACH DATABASE '${path.replaceAll("'", "''")}' AS batch`);
  try {
    const versionRow = db.getFirstSync<{ value: string }>(
      `SELECT value FROM batch.export_meta WHERE key = 'format_version'`,
    );
    const version = Number(versionRow?.value);
    assertVersion(version);

    const ids = db.getAllSync<{ id: number }>(`SELECT id FROM batch.insights`).map((r) => r.id);
    const existing = countExistingInsights(ids);
    const count = (table: string): number =>
      db.getFirstSync<{ n: number }>(`SELECT COUNT(*) n FROM batch.${table}`)?.n ?? 0;
    const postCount = count('posts');
    const commentCount = count('comments');

    db.withTransactionSync(() => {
      db.execSync(`INSERT INTO posts SELECT * FROM batch.posts WHERE true
        ON CONFLICT(id) DO UPDATE SET
          title               = excluded.title,
          selftext            = excluded.selftext,
          score               = excluded.score,
          num_comments        = excluded.num_comments,
          fetched_at          = excluded.fetched_at,
          comment_pass        = excluded.comment_pass,
          comments_fetched_at = excluded.comments_fetched_at,
          analyzed_at         = excluded.analyzed_at,
          analyze_attempts    = excluded.analyze_attempts`);
      db.execSync(`INSERT OR REPLACE INTO comments SELECT * FROM batch.comments`);
      db.execSync(`INSERT OR REPLACE INTO insights SELECT * FROM batch.insights`);
      // v2+ 批次带 translations 表（v1 无该表 → 跳过，避免 SELECT 不存在的表报错）
      if (version >= 2) {
        db.execSync(`INSERT OR REPLACE INTO translations SELECT * FROM batch.translations`);
      }
    });

    markImported();
    return {
      added: ids.length - existing,
      updated: existing,
      posts: postCount,
      comments: commentCount,
    };
  } finally {
    db.execSync(`DETACH DATABASE batch`);
  }
}

function markImported(): void {
  setMeta('last_import_at', String(Math.floor(Date.now() / 1000)));
}
