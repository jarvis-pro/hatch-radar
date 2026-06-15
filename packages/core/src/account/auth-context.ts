import type { CurrentUser } from '@hatch-radar/shared';

/**
 * 会话解析出的登录用户上下文（CurrentUser + 内部 sessionId）。框架无关的领域类型。
 * api 侧的 @AuthUser 装饰器与守卫会附加此对象;account/admin 服务以它作方法入参类型。
 */
export interface AuthedUser extends CurrentUser {
  /** 当前会话 id（用于「登出其它会话」/ 标记当前会话）。 */
  sessionId: string;
}
