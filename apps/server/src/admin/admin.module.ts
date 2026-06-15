import { Module } from '@nestjs/common';
import { AccountModule } from '@/account/account.module';
import { RepositoriesModule } from '@/db/repositories.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditController } from './audit.controller';

/**
 * 管理模块（后端归一 P2）：账户 / 权限 / 设备管理（accounts:manage）+ 审计日志（audit:view）。
 * 全部挂 SessionAuthGuard + 能力闸。
 */
@Module({
  imports: [RepositoriesModule, AccountModule],
  controllers: [AdminController, AuditController],
  providers: [AdminService],
})
export class AdminModule {}
