import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';

/**
 * 账户上下文：人鉴权权威服务（AccountService）+ 账户端点。
 *
 * 路由分工：本模块 AccountController 持 `/api/auth/*`（人/会话：登录 / 登出 / 校验 / 改密 / 会话管理 / 资料）。
 *
 * 全局会话守卫 SessionAuthGuard 及其 @Public/@RequirePermission/@AuthUser 装饰器、会话 cookie 助手
 * （`@/common/session-cookie`：readSessionCookie / CSRF_HEADER / set·clearSessionCookie）均在 `@/common`、
 * 经 AppModule 的 APP_GUARD 全局注册（fail-closed）。守卫实例在根上下文实例化，注入的 AccountService 经本模块
 * `exports` 跨模块解析（故该 export 为守卫所必需，勿删）。
 *
 * AccountService 为叶子（仅依赖全局仓储 / RuntimeSettings / TxContext），故本模块不 import 其它领域模块。
 */
@Module({
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
