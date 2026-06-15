import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { logger } from '@hatch-radar/kernel';
import { WorkerModule } from './worker.module';

/**
 * 独立 worker 进程入口（`pnpm --filter @hatch-radar/worker start`）。
 *
 * 以 standalone application context 引导（无 HTTP 监听）：worker 池经 PG 行锁认领、
 * WS 连 api 网关接活，与控制面解耦、可独立横向扩。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  // 优雅退出：SIGINT/SIGTERM 触发 WorkerStarter.onApplicationShutdown 排空在途任务
  app.enableShutdownHooks();
  logger.info('[worker] 独立 worker 进程已启动（消费同一 PG 队列）');
}

bootstrap().catch((err: unknown) => {
  logger.error(`worker 启动失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
