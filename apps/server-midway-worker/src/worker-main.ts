import 'reflect-metadata';
import { createDb } from '@hatch-radar/db';
import { createCore, loadEnv, logger } from '@hatch-radar/core';
import { WorkerAgentService } from './worker-agent';

/**
 * 独立 worker 进程入口（`pnpm --filter @hatch-radar/server-midway-worker start`）。
 *
 * 纯 ESM 引导：领域核心框架无关,worker 无需任何 Web 框架——loadEnv + createDb + createCore 即得全套实例,
 * 起 WorkerService（僵死回收/执行）+ WorkerAgentService（WS 连 API 网关认领任务）。
 * 与 API 解耦：只共享 PG 队列 + 一条 /ws/worker；可多实例横向扩。
 */
const env = loadEnv();
const handle = createDb(env.databaseUrl, { max: env.databasePoolMax });
const core = createCore(handle.db, env);

await handle.db.$queryRaw`select 1`;
logger.info('[db] PostgreSQL 连接就绪（独立 worker 进程）');

await core.worker.start();
const agent = new WorkerAgentService(env, core.worker);
agent.start();
logger.info('[worker] 独立 worker 进程已启动（消费同一 PG 队列，经 WS 连 API 网关）');

let stopping = false;
async function shutdown(sig: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info(`[worker] 收到 ${sig}，优雅退出…`);
  agent.stop();
  await core.worker.stop();
  await handle.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
