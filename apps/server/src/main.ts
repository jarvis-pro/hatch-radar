import 'reflect-metadata';
import { networkInterfaces } from 'node:os';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AnalysisConfigService } from './analysis/analysis-config.service';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { APP_ENV } from './common/tokens';
import type { AppEnv } from './config/env';
import { HN_SECTIONS, RSS_FEEDS } from './config/feeds';
import { SUBREDDITS } from './config/subreddits';
import { ProvidersRepository } from './db/providers.repository';
import { StatsRepository } from './db/stats.repository';
import { logger } from './logger';

/** 枚举本机非回环 IPv4 地址，方便在手机上直接填写 */
function lanAddresses(): string[] {
  const result: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) result.push(iface.address);
    }
  }
  return result;
}

/** 启动横幅：监控来源 / 分析模型 / 当前数据概览（DB 迁移已就绪后调用） */
async function logStartup(app: NestExpressApplication, env: AppEnv): Promise<void> {
  logger.info('hatch-radar 启动（NestJS + PostgreSQL）');

  const sources: string[] = [];
  if (env.reddit) {
    sources.push(`Reddit (${SUBREDDITS.map((s) => `r/${s}`).join(', ')})`);
  }
  sources.push(`HackerNews (${HN_SECTIONS.map((s) => s.channel).join(', ')})`);
  sources.push(`RSS (${RSS_FEEDS.map((f) => f.name).join(', ')})`);
  logger.info('监控来源 (%d):', sources.length);
  for (const src of sources) {
    logger.info('  · %s', src);
  }

  const active = await app.get(AnalysisConfigService).getActiveProvider();
  logger.info(
    '分析模型: %s | 每轮分析上限: %d',
    active ? active.label : '未配置（在设置页选用后即自动分析）',
    env.analyzeBatchSize,
  );
  const stats = await app.get(StatsRepository).getStats();
  logger.info(
    '当前数据: 帖子 %d / 评论 %d / 待分析 %d / 洞察 %d',
    stats.posts,
    stats.comments,
    stats.pendingAnalysis,
    stats.insights,
  );

  // 安全告警：已入库模型密钥但未设 API_TOKEN → 局域网内任何人都能调用写接口
  // （增删模型 / 触发分析 / 改 baseUrl）。密钥本身已加密入库，但开放的写接口仍是风险面。
  const providerCount = (await app.get(ProvidersRepository).listProviders()).length;
  if (providerCount > 0 && !env.http.token) {
    logger.warn(
      '[安全] 已配置 %d 个模型且未设 API_TOKEN：局域网内写接口（设置/分析）对所有人开放，建议设置 API_TOKEN（见 .env.example）',
      providerCount,
    );
  }
}

/**
 * 主进程入口（`pnpm start`）。
 *
 * 以 NestExpressApplication 引导：HTTP 监听 + 内嵌调度，对外提供 /api/* 导出/同步接口，
 * 与独立 worker 进程消费同一 PG 队列。启动后打印横幅（监控来源 / 分析模型 / 数据概览）。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  // 同步推送上限：outbox 操作很小，5MB 足够容纳上万条（对应裸跑实现）
  app.useBodyParser('json', { limit: '5mb' });
  app.useGlobalFilters(new AllExceptionsFilter());
  // 统一 API 前缀：控制器只声明各自子路径，外部路径仍为 /api/*（mobile / web 契约不变）
  app.setGlobalPrefix('api');
  // 优雅退出：触发各 service 的 OnApplicationShutdown（worker 排空、连接池关闭）
  app.enableShutdownHooks();

  const env = app.get<AppEnv>(APP_ENV);
  // 绑定 0.0.0.0 供局域网内的移动端访问
  await app.listen(env.http.port, '0.0.0.0');

  await logStartup(app, env);
  logger.info(
    '导出/同步服务已启动（端口 %d%s）',
    env.http.port,
    env.http.token ? '，已启用 Token 鉴权' : '',
  );
  for (const ip of lanAddresses()) {
    logger.info('  · 局域网地址: http://%s:%d', ip, env.http.port);
  }
}

bootstrap().catch((err: unknown) => {
  logger.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
