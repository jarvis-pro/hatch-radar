/**
 * `pnpm serve` 命令行入口：只启动局域网导出 HTTP 服务，不跑爬虫与 AI 分析。
 *
 * 适用场景：工作台只想给手机导数据（或验证接口）时，无需拉起完整调度进程。
 * 与主进程（pnpm dev / start）互斥使用没有限制——本进程对库只读不写，
 * better-sqlite3 + WAL 下与写进程并存安全。
 */
import { loadEnv } from './config/env';
import { getDb } from './db/schema';
import { getStats } from './db/utils';
import { logger } from './logger';
import { startHttpServer } from './server/http';

const env = loadEnv();
getDb();

const stats = getStats();
logger.info(
  `当前数据: 帖子 ${stats.posts} / 评论 ${stats.comments} / 待分析 ${stats.pendingAnalysis} / 洞察 ${stats.insights}`,
);
startHttpServer(env.http);
