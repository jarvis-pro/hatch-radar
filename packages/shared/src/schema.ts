/**
 * hatch-radar 数据库 schema（全量建表 DDL，含索引）。
 *
 * - `CREATE TABLE IF NOT EXISTS` 保证幂等，可在每次建立连接时重复执行
 * - 以 TS 常量内嵌而非 .sql 文件：server / web（better-sqlite3）与移动端
 *   （expo-sqlite / op-sqlite）共用同一份 DDL，无需运行时读文件
 */
export const DDL = `-- hatch-radar 数据库 schema
-- CREATE TABLE IF NOT EXISTS 保证幂等，可重复执行

-- ─── 帖子表 ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id                  TEXT PRIMARY KEY,           -- Reddit base36 / hn_{id} / rss_{sha1_16}
  source              TEXT NOT NULL DEFAULT 'reddit',  -- 'reddit' | 'hackernews' | 'rss'
  subreddit           TEXT NOT NULL,              -- 版块名或等效频道标识（如 ask_hn）
  title               TEXT NOT NULL,
  author              TEXT,
  selftext            TEXT NOT NULL DEFAULT '',
  url                 TEXT,
  permalink           TEXT,
  score               INTEGER NOT NULL DEFAULT 0,
  num_comments        INTEGER NOT NULL DEFAULT 0,
  created_utc         INTEGER NOT NULL,           -- Unix 秒
  fetched_at          INTEGER NOT NULL,           -- 首次抓取时间，Unix 秒
  -- 评论回捞进度：0=未抓 1=6h已抓 2=完成（RSS 帖子直接写 2，跳过评论阶段）
  comment_pass        INTEGER NOT NULL DEFAULT 0,
  comments_fetched_at INTEGER,                    -- 最近一次评论抓取时间，Unix 秒
  analyzed_at         INTEGER,                    -- AI 分析完成时间，Unix 秒；NULL 表示待分析（仅 anthropic/deepseek 自动模式使用）
  analyze_attempts    INTEGER NOT NULL DEFAULT 0, -- 连续失败次数；超过阈值将跳过该帖子
  comments_changed_at INTEGER,                    -- 评论快照内容最近变更时间，Unix 秒（diff 得出；驱动"反馈后又变"重列）
  export_locked_at    INTEGER                     -- 导出冻结时间戳，Unix 秒；NULL=未冻结，置位时暂停评论 refresh
);

-- 按版块浏览
CREATE INDEX IF NOT EXISTS idx_posts_subreddit ON posts (subreddit);
-- 时间线排序
CREATE INDEX IF NOT EXISTS idx_posts_created   ON posts (created_utc);
-- getPostsToAnalyze / getPostsDueForComments 的覆盖索引
CREATE INDEX IF NOT EXISTS idx_posts_pending   ON posts (analyzed_at, comment_pass);

-- ─── 评论表 ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id   TEXT,                               -- NULL 表示顶级评论，否则为父评论 id
  author      TEXT,
  body        TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  depth       INTEGER NOT NULL DEFAULT 0,         -- 0=顶级 1=二级，以此类推
  created_utc INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL
);

-- 按帖子查评论（AI 分析最频繁的查询路径）
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id);

-- ─── 洞察表 ─────────────────────────────────────────────────────────────────
-- AI 分析结果；原始帖子归档后仍永久保留，post_id 作为软引用
CREATE TABLE IF NOT EXISTS insights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id       TEXT NOT NULL,                    -- 对应 posts.id；帖子归档后 FK 失效，保留字段用于溯源
  source        TEXT NOT NULL DEFAULT 'reddit',
  subreddit     TEXT NOT NULL,
  post_title    TEXT NOT NULL,
  permalink     TEXT,
  model         TEXT NOT NULL,                    -- 分析所用模型 ID
  intensity     TEXT NOT NULL CHECK (intensity IN ('HIGH', 'MEDIUM', 'LOW')),
  pain_points   TEXT NOT NULL,                    -- JSON 数组，结构见 PainPoint 接口
  opportunities TEXT NOT NULL,                    -- JSON 数组，结构见 Opportunity 接口
  tags          TEXT NOT NULL,                    -- JSON 字符串数组
  created_at    INTEGER NOT NULL                  -- Unix 秒
);

-- 防止同一帖子重复写入洞察
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_post      ON insights (post_id);
CREATE INDEX IF NOT EXISTS        idx_insights_subreddit ON insights (subreddit);
CREATE INDEX IF NOT EXISTS        idx_insights_intensity ON insights (intensity);
`;
