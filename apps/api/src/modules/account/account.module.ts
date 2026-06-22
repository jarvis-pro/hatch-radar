import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { SessionAuthGuard } from './session-auth.guard';

/**
 * 账户模块：人鉴权权威端点（AccountController）+ SessionAuthGuard。
 * AccountService 本体在 @/domain（CoreModule 全局提供）；本模块只放控制器与守卫,
 * 并导出 SessionAuthGuard 供其它受保护端点（数据/管理/设置/导出同步）复用。
 */
@Module({
  controllers: [AccountController],
  providers: [SessionAuthGuard],
  exports: [SessionAuthGuard],
})
export class AccountModule {}
