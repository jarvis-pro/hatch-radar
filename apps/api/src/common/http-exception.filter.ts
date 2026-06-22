import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { logger } from '@/logger';

/**
 * 全局异常过滤器：把所有异常统一序列化为 `{ error: <message> }`，保持与裸跑 HTTP 层
 * 字节级一致的错误响应契约（mobile / web 依赖）。经 APP_FILTER 由 DI 容器装配（见 AppModule），
 * 故可被注入、可在测试中替换，不再 main.ts 里 `new`。
 *
 * - HttpException：用其状态码与 message
 * - 带数字 status/statusCode 的错误（领域层 DomainError、body-parser 的 413 等）：透传其状态码
 * - 其它未知错误：500 + `internal error`（真实堆栈仅落日志，不外泄）
 *
 * 可观测性：所有 5xx 一律记录根因（含被领域层兜底成 503 的意外错误、未携带 HttpException 的未知异常），
 * 否则「服务暂时不可用」类响应在日志里无迹可循；4xx 属预期客户端错误，不刷错误日志。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
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
      }
    }

    if (status >= 500) {
      const detail =
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      logger.error(`[HTTP] ${status} ${message}: ${detail}`);
    }

    res.status(status).json({ error: message });
  }
}
