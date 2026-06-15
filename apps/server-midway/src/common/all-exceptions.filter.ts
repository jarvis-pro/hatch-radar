import { Catch } from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
import { logger } from '@/logger';

/**
 * 全局异常过滤器：把所有异常统一序列化为 `{ error: <message> }`，
 * 与 NestJS 版 AllExceptionsFilter 字节级一致的错误响应契约（mobile / web 依赖）。
 *
 * - 带数字 status/statusCode 的错误（Midway httpError.* / MidwayHttpError / body-parser 413）：透传其状态码与 message；
 * - 其它未知错误：500 + `internal error`（真实堆栈仅落日志，不外泄）。
 */
@Catch()
export class AllExceptionsFilter {
  async catch(err: unknown, ctx: Context): Promise<void> {
    let status = 500;
    let message = 'internal error';

    const anyErr = err as { status?: number; statusCode?: number; message?: unknown };
    const code = anyErr?.status ?? anyErr?.statusCode;
    if (typeof code === 'number') {
      status = code;
      const m = anyErr.message;
      message = Array.isArray(m) ? m.join('; ') : (m != null ? String(m) : 'error');
    } else {
      logger.error(
        `[HTTP] 处理失败: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }

    ctx.status = status;
    ctx.body = { error: message };
  }
}
