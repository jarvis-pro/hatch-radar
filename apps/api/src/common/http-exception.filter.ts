import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from './errors';
import { logger } from '@/logger';

/**
 * 领域错误子类型 → HTTP 状态码（**传输层职责**：领域层只表达业务语义、不含 HTTP 概念，
 * 映射收口在此处）。未知子类按客户端错误（400）兜底。
 */
function domainStatus(e: DomainError): number {
  if (e instanceof ValidationError) return 400;
  if (e instanceof UnauthorizedError) return 401;
  if (e instanceof ForbiddenError) return 403;
  if (e instanceof NotFoundError) return 404;
  if (e instanceof ConflictError) return 409;
  if (e instanceof RateLimitError) return 429;
  if (e instanceof ServiceUnavailableError) return 503;
  return 400;
}

/**
 * 全局异常过滤器：把所有异常统一序列化为 `{ error: <message> }`，保持与裸跑 HTTP 层
 * 字节级一致的错误响应契约（mobile / web 依赖）。经 APP_FILTER 由 DI 容器装配（见 AppModule）。
 *
 * - DomainError 子类：按 {@link domainStatus} 映射状态码（领域错误的传输层翻译收口于此）
 * - HttpException：用其状态码与 message
 * - 带数字 status/statusCode 的错误（body-parser 的 413 等）：透传其状态码
 * - 其它未知错误：500 + `internal error`（真实堆栈仅落日志，不外泄）
 *
 * 可观测性：所有 5xx 一律记录根因（含兜底成 503 的意外错误、未携带状态的未知异常），否则
 * 「服务暂时不可用」类响应在日志里无迹可循；4xx 属预期客户端错误，不刷错误日志。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message = 'internal error';

    if (exception instanceof DomainError) {
      status = domainStatus(exception);
      message = exception.message;
    } else if (exception instanceof HttpException) {
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
