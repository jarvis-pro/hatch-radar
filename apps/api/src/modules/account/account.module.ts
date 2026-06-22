import { Module } from '@nestjs/common';
import { AccountService } from '@/domain';
import { AccountController } from './account.controller';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionAuthenticator } from './session-authenticator';

/**
 * 账户上下文：人鉴权权威服务（AccountService）+ 会话守卫 + 共享会话校验原语 + 账户端点。
 * AccountService 为叶子（仅依赖全局仓储 / RuntimeSettings / TxContext），故本模块不 import 其它领域模块。
 * 导出 AccountService（受保护控制器如 /api/me 用）/ SessionAuthGuard / SessionAuthenticator（双通道守卫复用）。
 */
@Module({
  controllers: [AccountController],
  providers: [AccountService, SessionAuthenticator, SessionAuthGuard],
  exports: [AccountService, SessionAuthenticator, SessionAuthGuard],
})
export class AccountModule {}
