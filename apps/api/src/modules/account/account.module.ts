import { Module } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';
import { AccountController } from './account.controller';
import { SessionAuthGuard } from './session-auth.guard';

/**
 * 账户模块：人鉴权权威端点（AccountController）+ SessionAuthGuard。
 * AccountService 本体在 @/domain（CoreModule 提供，须显式 import——CoreModule 已去 @Global）；
 * 本模块只放控制器与守卫，并导出 SessionAuthGuard 供其它受保护端点（数据/管理/设置/导出同步）复用。
 */
@Module({
  imports: [CoreModule],
  controllers: [AccountController],
  providers: [SessionAuthGuard],
  exports: [SessionAuthGuard],
})
export class AccountModule {}
