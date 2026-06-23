import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionAuthenticator } from './session-authenticator';

/**
 * 账户上下文：人鉴权权威服务（AccountService）+ 会话守卫 + 共享会话校验原语 + 账户端点。
 *
 * 路由分工：本模块 AccountController 持 `/api/auth/*`（人/会话：登录 / 登出 / 校验 / 改密 / 会话管理 / 资料），
 * auth 模块控制器持 `/api/auth/device/*`（设备 Ed25519 凭据激活）——同一 `/api/auth` 前缀按「人 vs 设备」分属两模块。
 *
 * AccountService 为叶子（仅依赖全局仓储 / RuntimeSettings / TxContext），故本模块不 import 其它领域模块。
 * 导出 AccountService（受保护控制器如 /api/me 用）/ SessionAuthGuard / SessionAuthenticator（双通道守卫复用）。
 */
@Module({
  controllers: [AccountController],
  providers: [AccountService, SessionAuthenticator, SessionAuthGuard],
  exports: [AccountService, SessionAuthenticator, SessionAuthGuard],
})
export class AccountModule {}
