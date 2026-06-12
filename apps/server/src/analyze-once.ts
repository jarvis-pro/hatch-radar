/**
 * `pnpm analyze` 命令行入口：手动触发一轮 AI 分析。
 *
 * 顶层脚本（无导出符号），import 即执行：加载配置 → 取一批待分析帖子 →
 * 交由 AI_PROVIDER 对应的处理器分析/导出 → 落库并退出。
 * 每次至多处理 ANALYZE_BATCH_SIZE 篇；要处理更多可重复运行或调大该值。
 */
import { createProcessor, runAnalysisBatch } from './analyzer/analyze';
import { loadEnv } from './config/env';
import { closeDb, getDb } from './db/schema';
import { logger } from './logger';

async function main(): Promise<void> {
  const env = loadEnv();
  getDb();
  const processor = createProcessor(env.analysis);
  logger.info(`手动分析一轮（${processor.label}）`);
  const stats = await runAnalysisBatch(processor, env.analyzeBatchSize);
  logger.info(
    `完成：处理 ${stats.analyzed} 篇，产出洞察 ${stats.saved} 条，失败 ${stats.failed} 篇`,
  );
  closeDb();
}

main().catch((err) => {
  logger.error(`分析失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
