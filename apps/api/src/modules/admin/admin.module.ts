import { Module } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';
import { AccountModule } from '@/modules/account/account.module';
import { AdminController } from './admin.controller';
import { AuditController } from './audit.controller';

/**
 * 管理模块（后端归一 P2）：账户 / 权限 / 设备管理（accounts:manage）+ 审计日志（audit:view）。
 * 全部挂 SessionAuthGuard（import AccountModule 取守卫）+ 能力闸；AdminService 等由 CoreModule 提供
 * （须显式 import——CoreModule 已去 @Global）。
 */
@Module({
  imports: [CoreModule, AccountModule],
  controllers: [AdminController, AuditController],
})
export class AdminModule {}
