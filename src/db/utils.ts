import { getDb } from './schema.js';

/** 返回当前 Unix 时间戳（秒） */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 返回数据库各表的当前行数汇总，用于启动日志与监控。
 * @returns posts / comments / 待分析帖子数 / insights 的当前计数
 */
export function getStats(): {
  posts: number;
  comments: number;
  pendingAnalysis: number;
  insights: number;
} {
  const db = getDb();
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    posts: count(`SELECT COUNT(*) n FROM posts`),
    comments: count(`SELECT COUNT(*) n FROM comments`),
    pendingAnalysis: count(
      `SELECT COUNT(*) n FROM posts WHERE analyzed_at IS NULL AND comment_pass >= 1 AND analyze_attempts < 3`,
    ),
    insights: count(`SELECT COUNT(*) n FROM insights`),
  };
}
