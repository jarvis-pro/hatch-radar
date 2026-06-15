import { networkInterfaces } from 'node:os';
import {
  App,
  Configuration,
  ESModuleFileDetector,
  Inject,
  type IMidwayContainer,
  MidwayDecoratorService,
} from '@midwayjs/core';
import * as cron from '@midwayjs/cron';
import * as koa from '@midwayjs/koa';
import { createCore, type Core, logger, nowSec } from '@hatch-radar/core';
import { closeDb, getDbHandle, getEnv } from '@/bootstrap/providers';
import { AllExceptionsFilter } from '@/common/all-exceptions.filter';
import { registerParams } from '@/common/params';
import { APP_ENV, PRISMA } from '@/common/tokens';
import defaultConfig from '@/config/config.default';
import { SpaMiddleware } from '@/web/spa.middleware';

/** 枚举本机非回环 IPv4 地址，方便在手机上直接填写。 */
function lanAddresses(): string[] {
  const result: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) result.push(iface.address);
    }
  }
  return result;
}

/**
 * API 进程根配置（控制面：HTTP + 鉴权 + 定时调度 + push 网关）。
 *
 * 领域逻辑全在 @hatch-radar/core：onReady 里 createCore 装配出全套实例,registerObject 以 `core:<key>`
 * 令牌登记,控制器/守卫按令牌注入（Midway 无法按类型注入纯类,故走字符串令牌,同 PRISMA）。
 * worker 执行器不在本进程——独立的 server-midway-worker 进程消费同一 PG 队列、经 /ws/worker 连本网关。
 */
@Configuration({
  imports: [koa, cron],
  importConfigs: [{ default: defaultConfig }],
  detector: new ESModuleFileDetector({
    ignore: ['**/main.{ts,js}', '**/worker-main.{ts,js}', '**/worker.configuration.{ts,js}'],
  }),
})
export class MainConfiguration {
  @App()
  app!: koa.Application;

  @Inject()
  decoratorService!: MidwayDecoratorService;

  private core?: Core;

  async onReady(container: IMidwayContainer): Promise<void> {
    // 底层资源 + 领域装配,须早于任何控制器/守卫解析。
    container.registerObject(PRISMA, getDbHandle().db);
    container.registerObject(APP_ENV, getEnv());
    const core = createCore(getDbHandle().db, getEnv());
    this.core = core;
    // 把 createCore 的每个实例以 `core:<键>` 登记进容器（与 common/tokens 的 TOK 一一对应）
    for (const [key, instance] of Object.entries(core)) {
      container.registerObject(`core:${key}`, instance);
    }

    // 自定义参数装饰器 handler（@AuthUser/@DeviceUser/@ValidBody/@ValidQuery/@IntParam）
    registerParams(this.decoratorService);
    // 全局异常过滤器（统一 { error }）+ SPA 同源托管中间件
    this.app.useFilter([AllExceptionsFilter]);
    this.app.useMiddleware([SpaMiddleware]);

    // DB 连通性自检
    await getDbHandle().db.$queryRaw`select 1`;
    logger.info('[db] PostgreSQL 连接就绪');

    // 种子：须早于 scheduler 初始轮
    await core.seedRunner.run(nowSec());
  }

  async onServerReady(container: IMidwayContainer): Promise<void> {
    const core = this.core;
    if (!core) return;
    // 取 koa 底层 http.Server，把 worker WS 网关挂上去（同端口 /ws/worker，push 派发）
    const framework = await container.getAsync(koa.Framework);
    core.gateway.start(framework.getServer());
    // 调度初始化轮次（不阻塞）。定时任务由 scheduler/jobs.ts 的 @Job 触发,委托 core.scheduler。
    void core.scheduler.runInitialRound();
    await this.logStartup();
  }

  async onStop(): Promise<void> {
    this.core?.gateway.stop();
    await closeDb();
  }

  /** 启动横幅：监控来源 / 分析模型 / 当前数据概览。 */
  private async logStartup(): Promise<void> {
    const core = this.core;
    if (!core) return;
    logger.info('hatch-radar 启动（MidwayJS API + PostgreSQL）');

    const enabledSources = (await core.sources.listSources()).filter((s) => s.enabled);
    const byPlatform = (p: string): string[] =>
      enabledSources.filter((s) => s.platform === p).map((s) => s.label || s.identifier);
    const reddit = byPlatform('reddit');
    const hn = byPlatform('hackernews');
    const rss = byPlatform('rss');
    const sources: string[] = [];
    if (reddit.length > 0) {
      const usable = await core.sourceConnectors.hasUsableConnector('reddit');
      sources.push(`Reddit (${reddit.join(', ')})${usable ? '' : ' [无可用连接器，本轮跳过]'}`);
    }
    if (hn.length > 0) sources.push(`HackerNews (${hn.join(', ')})`);
    if (rss.length > 0) sources.push(`RSS (${rss.join(', ')})`);
    logger.info('监控来源 (%d 启用):', sources.length);
    for (const src of sources) logger.info('  · %s', src);

    const active = await core.analysisConfig.getActiveProvider();
    logger.info(
      '分析模型: %s | 每轮分析上限: %d',
      active ? active.label : '未配置（在设置页选用后即自动分析）',
      await core.runtimeSettings.getAnalyzeBatchSize(),
    );
    const stats = await core.stats.getStats();
    logger.info(
      '当前数据: 帖子 %d / 评论 %d / 待分析 %d / 洞察 %d',
      stats.posts,
      stats.comments,
      stats.pendingAnalysis,
      stats.insights,
    );

    const port = getEnv().http.port;
    logger.info('服务已启动（端口 %d，鉴权恒开：会话 / 设备签名）', port);
    for (const ip of lanAddresses()) {
      logger.info('  · 局域网地址: http://%s:%d', ip, port);
    }
  }
}
