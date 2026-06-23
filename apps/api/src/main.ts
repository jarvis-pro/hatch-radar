import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { type AppEnv, isProd } from '@/config/env';
import { logger } from '@/logger';
import { AppModule } from './app.module';
import { APP_ENV } from './common/tokens';

/** 解析 TRUST_PROXY env：'true'/'false' → 布尔；非负整数字符串 → 代理层数；其余（如 'loopback'）原样。 */
function parseTrustProxy(raw: string): boolean | number | string {
  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  const n = Number(raw);

  return Number.isInteger(n) && n >= 0 ? n : raw;
}

/**
 * 挂载交互式 API 文档（Swagger UI）于 `/docs`，仅非生产环境——避免对外泄露完整接口目录。
 *
 * 文档内的操作路径默认带全局前缀 `/api`（`ignoreGlobalPrefix` 默认 false），故 “Try it out”
 * 直接命中真实路由。登记鉴权方案供调试：会话 cookie（`radar_session`）+ 写请求 CSRF 头
 * （`X-Radar-Csrf`）。
 *
 * 注：本仓直跑 TS 源（`@swc-node/register`、无 `nest build`），`@nestjs/swagger` 的自动内省
 * CLI 插件挂不上，故 DTO 的请求 / 响应富 schema 需在控制器 / DTO 上手写 `@ApiProperty`、
 * `@ApiResponse` 增量补充；未标注的端点仍会列出，仅 body / 响应结构为空。
 */
function mountApiDocs(app: NestExpressApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Hatch Radar API')
    .setDescription('工作台后端 API —— 仅非生产环境暴露，供本地调试与文档浏览')
    .setVersion('0.1.0')
    .addCookieAuth('radar_session')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Radar-Csrf' }, 'csrf')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // persistAuthorization：刷新后保留已填的 cookie / CSRF，免反复输入
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Hatch Radar API',
    swaggerOptions: { persistAuthorization: true },
  });
}

/**
 * 后端唯一进程入口（`pnpm start:api`）—— 单实例。
 *
 * 以 NestExpressApplication 引导：HTTP 监听（/api）+ @Cron 调度 + 内嵌任务执行
 * （经 PG 持久化队列 + LocalDispatcher 进程内认领）。web SPA 单独部署，不在此进程托管。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  // 请求体上限放宽（默认 100kb 偏小，部分配置 / 批量端点的 JSON 入参可能超过）。
  app.useBodyParser('json', { limit: '5mb' });
  // 全局异常过滤器经 APP_FILTER 在 AppModule 注册（DI 装配），此处不再手动 useGlobalFilters。
  // 统一 API 前缀：控制器只声明各自子路径，外部路径仍为 /api/*
  app.setGlobalPrefix('api');
  // 优雅退出：触发各 service 的 OnApplicationShutdown（worker 排空、连接池关闭）
  app.enableShutdownHooks();

  const env = app.get<AppEnv>(APP_ENV);
  // 信任代理（反代场景）：使 req.ip 按代理链正确解析、审计 IP 不被伪造的 x-forwarded-for 污染。留空＝不信任。
  if (env.trustProxy) {
    app.set('trust proxy', parseTrustProxy(env.trustProxy));
  }

  // 跨源放行：web 与 api 不同源部署时必填白名单（带凭据）；同源 / 反代留空即不开（浏览器同源策略足矣）。
  if (env.corsOrigins.length > 0) {
    app.enableCors({ origin: env.corsOrigins, credentials: true });
  }

  // 交互式 API 文档（Swagger UI @ /docs）：仅非生产环境挂载（静态文档页公开，实际调用仍走守卫）。
  if (!isProd()) {
    mountApiDocs(app);
  }

  // 绑 0.0.0.0：监听本机所有网卡，使本进程同时经 localhost 与局域网 IP 可达（web 独立部署经 /api 调本服务）。
  // 网络位置不参与鉴权：恒开、fail-closed——会话 cookie 一处校验。
  await app.listen(env.http.port, '0.0.0.0');

  logger.info('服务已启动（端口 %d，鉴权恒开：会话）', env.http.port);
}

bootstrap().catch((err: unknown) => {
  logger.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
