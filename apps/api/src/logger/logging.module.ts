import { RequestMethod } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { logger } from './index';

/**
 * 应用级日志（nestjs-pino，底层复用 @/logger 的 pino 实例）+ 每请求一行 HTTP 访问日志
 * （方法 + 路径 + 状态码 + 耗时，已登录附 userId）。
 *
 * 日志在 HTTP 层（pino-http，autoLogging 默认即开）产生，故覆盖全部请求——含被守卫拒的 401/403、
 * 未命中的 404 这些到不了控制器的情形。级别按状态码分：5xx / 异常→error，4xx→warn，其余→info。
 */
export const LoggingModule: DynamicModule = LoggerModule.forRoot({
  pinoHttp: {
    logger,
    // context:'HTTP' 驱动 pretty 前缀 `[HTTP]`（见 @/logger 的 messageFormat / ignore）。
    customProps: (req) => {
      const userId = (req as { user?: { id?: string } }).user?.id;

      return userId ? { context: 'HTTP', userId } : { context: 'HTTP' };
    },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${(req as { originalUrl?: string }).originalUrl ?? req.url} ${res.statusCode} ${responseTime}ms`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${(req as { originalUrl?: string }).originalUrl ?? req.url} ${res.statusCode} ${err.message}`,
  },
  // 用命名通配 `{*path}` 而非默认 `*`：叠加全局前缀得合法的 `/api/{*path}`，避开 Nest 的 LegacyRouteConverter 警告。
  forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
});
