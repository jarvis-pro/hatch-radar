import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

/**
 * 管理上下文（后端归一 P2）：账户 / 权限 / 设备管理（accounts:manage）+ 审计日志（audit:view）。
 * 审计日志（GET /api/admin/audit）并入 AdminController，以方法级 @RequirePermission('audit:view')
 * 覆盖类级 accounts:manage（守卫 getAllAndOverride 方法级优先）。
 * 受全局会话守卫保护 + 能力闸；AdminService 为叶子（仅全局仓储）。
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
