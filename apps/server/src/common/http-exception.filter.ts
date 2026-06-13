import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * 全局异常过滤器：把所有异常统一序列化为 `{ error: <message> }`，保持与裸跑 HTTP 层
 * 字节级一致的错误响应契约（mobile / web 依赖）。
 *
 * - HttpException：用其状态码与 message
 * - 带数字 status/statusCode 的错误（如 body-parser 的 413 entity too large）：透传其状态码
 * - 其它未知错误：500 + `internal error`（真实堆栈仅落日志，不外泄）
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message = 'internal error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const m = (body as { message?: unknown }).message ?? exception.message;
        message = Array.isArray(m) ? m.join('; ') : String(m);
      }
    } else {
      const anyExc = exception as { status?: number; statusCode?: number; message?: string };
      const code = anyExc?.status ?? anyExc?.statusCode;
      if (typeof code === 'number') {
        status = code;
        message = anyExc.message ?? 'error';
      } else {
        this.logger.error(
          `处理失败: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
        );
      }
    }

    res.status(status).json({ error: message });
  }
}
