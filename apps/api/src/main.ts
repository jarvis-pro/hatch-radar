import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
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

/** Swagger 文档中算作「操作」的 HTTP 方法（PathItem 上其余键如 parameters / summary 跳过）。 */
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

/** 由路由 + 方法生成稳定唯一的请求体模型名，如 POST /api/auth/login → `AuthLoginPostBody`。 */
function bodyModelName(path: string, method: string): string {
  const segments = path
    .replace(/^\/api\//, '')
    .split('/')
    .filter((s) => s && !s.startsWith(':') && !s.startsWith('{'))
    .flatMap((s) => s.split('-'));
  const pascal = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  const verb = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();

  return `${pascal}${verb}Body`;
}

/**
 * 把各端点内联的请求体 schema（@ZodBody 声明为 x-www-form-urlencoded）上提为 components/schemas 命名模型、原引用改 $ref。
 *
 * @ZodBody 已由 zod schema 派生出内联 body schema；此处统一抽成命名模型，Swagger UI 的「Schemas」区
 * 因而列出每个入参模型、可点开复用，比满屏匿名内联结构更易读。原地改写传入的 document；同名冲突追加序号。
 */
function hoistRequestBodies(document: OpenAPIObject): void {
  const components = (document.components ??= {});
  const schemas = (components.schemas ??= {}) as Record<string, unknown>;
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      const content = (
        operation as {
          requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
        }
      ).requestBody?.content;
      if (!content) {
        continue;
      }

      // 通常每个 body 只有一种媒体类型（此处为 form 编码）；逐个处理以防未来多媒体类型并存。
      for (const media of Object.values(content)) {
        if (!media?.schema || '$ref' in media.schema) {
          continue;
        }

        let name = bodyModelName(path, method);
        for (let n = 2; name in schemas; n++) {
          name = `${bodyModelName(path, method)}${n}`;
        }

        schemas[name] = media.schema;
        media.schema = { $ref: `#/components/schemas/${name}` };
      }
    }
  }
}

/**
 * 挂载交互式 API 文档（Swagger UI）于 `/docs`，仅非生产环境——避免对外泄露完整接口目录。
 *
 * 文档内的操作路径默认带全局前缀 `/api`（`ignoreGlobalPrefix` 默认 false），故 “Try it out”
 * 直接命中真实路由。登记鉴权方案供调试：会话 cookie（`radar_session`）+ 写请求 CSRF 头（`X-Radar-Csrf`）。
 *
 * 注：本仓直跑 TS 源（`@swc-node/register`、无 `nest build`），swagger 自动内省插件挂不上。请求体已由
 * `@ZodBody` 从 zod schema 自动派生 schema（再经 hoistRequestBodies 抽成命名模型 + 字段 `.describe()` 说明）；
 * 响应富 schema 仍需在控制器手写 `@ApiResponse` 增量补充，未标注响应的端点仅列出、响应结构为空。
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
  // 把内联请求体 schema 抽成 components/schemas 命名模型（@ZodBody 已从 zod 派生出 body schema）。
  hoistRequestBodies(document);
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
  // 同时收表单编码：Swagger 以 x-www-form-urlencoded 渲染逐字段输入控件，"Try it out" 提交即走此解析
  //（extended 用 qs 支持嵌套）；前端仍发 JSON，两者并存。表单字符串值由 ZodValidationPipe 按声明类型还原。
  app.useBodyParser('urlencoded', { extended: true, limit: '5mb' });
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
