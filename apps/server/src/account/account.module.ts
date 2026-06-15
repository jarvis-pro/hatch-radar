import { Module } from '@nestjs/common';
import { RuntimeSettingsModule } from '@/config/runtime-settings.module';
import { RepositoriesModule } from '@/db/repositories.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { SessionAuthGuard } from './session-auth.guard';

/**
 * 账户模块：人鉴权权威（会话登录/校验/改密/会话管理）+ SessionAuthGuard。
 * 导出 AccountService 与 SessionAuthGuard 供所有 web 面向端点（设置/数据/管理/导出同步）复用。
 */
@Module({
  imports: [RepositoriesModule, RuntimeSettingsModule],
  controllers: [AccountController],
  providers: [AccountService, SessionAuthGuard],
  exports: [AccountService, SessionAuthGuard],
})
export class AccountModule {}
