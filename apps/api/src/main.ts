import 'reflect-metadata';
import { networkInterfaces } from 'node:os';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import {
  AnalysisConfigService,
  type AppEnv,
  logger,
  RuntimeSettingsService,
  SourceConnectorsRepository,
  SourcesRepository,
  StatsRepository,
} from '@/domain';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { APP_ENV } from './common/tokens';

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
async function logStartup(app: NestExpressApplication): Promise<void> {
  const enabledSources = (await app.get(SourcesRepository).listSources()).filter((s) => s.enabled);
  const byPlatform = (p: string): string[] =>
    enabledSources.filter((s) => s.platform === p).map((s) => s.label || s.identifier);
  const reddit = byPlatform('reddit');
  const hn = byPlatform('hackernews');
  const rss = byPlatform('rss');
  const sources: string[] = [];
  if (reddit.length > 0) {
    const usable = await app.get(SourceConnectorsRepository).hasUsableConnector('reddit');
    sources.push(`Reddit (${reddit.join(', ')})${usable ? '' : ' [无可用连接器，需在设置页配置]'}`);
  }
  if (hn.length > 0) sources.push(`HackerNews (${hn.join(', ')})`);
  if (rss.length > 0) sources.push(`RSS (${rss.join(', ')})`);
  logger.info('监控来源 (%d 启用):', sources.length);
  for (const src of sources) {
    logger.info('  · %s', src);
  }

  const active = await app.get(AnalysisConfigService).getActiveProvider();
  logger.info(
    '分析模型: %s | 每轮分析上限: %d',
    active ? active.label : '未配置（在设置页选用后即自动分析）',
    await app.get(RuntimeSettingsService).getAnalyzeBatchSize(),
  );
  const stats = await app.get(StatsRepository).getStats();
  logger.info(
    '当前数据: 帖子 %d / 评论 %d / 待分析 %d / 洞察 %d',
    stats.posts,
    stats.comments,
    stats.pendingAnalysis,
    stats.insights,
  );
}

/**
 * 主进程入口（`pnpm start:api`）—— 控制面，单实例。
 *
 * 以 NestExpressApplication 引导：HTTP 监听 + @Cron 调度 + WS 网关 + 同源托管 web SPA，
 * 对外提供全部 /api/* 控制面接口；与独立 worker（数据面，可多开）经 PG 任务队列 + WS 网关解耦。
 * 启动后打印横幅（监控来源 / 分析模型 / 数据概览）。
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
  // 绑 0.0.0.0：监听本机所有网卡，使本进程同时经 localhost 与局域网 IP 可达。
  // web（同源托管的 SPA + /api）与 mobile 共用这一监听；只是 mobile 必须走局域网 IP
  // （手机是 LAN 上的另一台设备），故不能只绑回环——这才是对外开放的原因。
  // 网络位置不参与鉴权：恒开、fail-closed——人=会话 cookie、mobile=设备签名，守卫一处校验。
  await app.listen(env.http.port, '0.0.0.0');

  await logStartup(app);
  logger.info('服务已启动（端口 %d，鉴权恒开：会话 / 设备签名）', env.http.port);
  for (const ip of lanAddresses()) {
    logger.info('  · 局域网地址: http://%s:%d', ip, env.http.port);
  }
}

bootstrap().catch((err: unknown) => {
  logger.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
