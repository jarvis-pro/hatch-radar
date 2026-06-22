/**
 * 框架无关的领域错误：只表达**业务语义**，不内嵌任何传输层（HTTP）概念。
 *
 * HTTP 状态码映射由 app 的异常过滤器按**子类型**负责（见 common/http-exception.filter）——
 * 领域层因此不依赖 Web 框架、也不背 HTTP 数字；将来新增传输（gRPC / CLI）只需另写一份映射。
 * 服务里 `catch (e) { if (e instanceof DomainError) throw e; ... }` 的分流仍有效（子类均 instanceof 基类）。
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name; // 子类名进栈帧（ValidationError 等），便于排查
  }
}

/** 入参非法 / 业务规则校验失败（过滤器 → 400）。 */
export class ValidationError extends DomainError {}

/** 未认证 / 凭据无效（→ 401）。 */
export class UnauthorizedError extends DomainError {}

/** 已认证但无权限 / 操作被禁止（→ 403）。 */
export class ForbiddenError extends DomainError {}

/** 目标资源不存在（→ 404）。 */
export class NotFoundError extends DomainError {}

/** 与现有状态冲突（重复 / 并发等）（→ 409）。 */
export class ConflictError extends DomainError {}

/** 触发频率限制（→ 429）。 */
export class RateLimitError extends DomainError {}

/** 依赖暂时不可用（DB 抖动等），调用方可稍后重试（→ 503）。 */
export class ServiceUnavailableError extends DomainError {}
