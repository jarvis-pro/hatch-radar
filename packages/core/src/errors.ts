/**
 * 框架无关的领域错误：携带 HTTP 状态码,由各 app 的异常过滤器映射成响应
 * （Midway 版 AllExceptionsFilter / 未来 Nest 版的 filter 都按 `.status` 数字字段处理,
 * 与 httpError / HttpException 同一路径,故 `{ error }` 契约不变）。
 *
 * core 不能依赖任何 Web 框架,所以业务校验失败抛此错误而非 httpError.*。
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
