import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { logger } from './logger';
import { WorkerStandaloneModule } from './worker/worker-standalone.module';

/**
 * 独立 worker 进程入口（`pnpm worker`）。
 *
 * 以 standalone application context 引导（无 HTTP 监听）；worker 池经 PG 行锁认领，
 * 与主进程（HTTP + 调度）解耦、可独立扩。enableShutdownHooks 接住 SIGINT/SIGTERM
 * 触发 WorkerService 优雅排空在途任务。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerStandaloneModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.enableShutdownHooks();
  logger.info('[worker] 独立 worker 进程已启动（消费同一 PG 队列）');
}

bootstrap().catch((err: unknown) => {
  logger.error(`worker 启动失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
