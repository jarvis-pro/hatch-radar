import { Module } from '@nestjs/common';
import { AdminService } from '@/domain';
import { AccountModule } from '@/modules/account/account.module';
import { AdminController } from './admin.controller';
import { AuditController } from './audit.controller';

/**
 * 管理上下文（后端归一 P2）：账户 / 权限 / 设备管理（accounts:manage）+ 审计日志（audit:view）。
 * 全部挂 SessionAuthGuard（import AccountModule 取守卫）+ 能力闸；AdminService 为叶子（仅全局仓储）。
 */
@Module({
  imports: [AccountModule],
  controllers: [AdminController, AuditController],
  providers: [AdminService],
})
export class AdminModule {}
