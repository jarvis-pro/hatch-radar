import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthedUser } from '@/types/auth-context';
import { AuthUser, RequirePermission } from '@/modules/account/auth-user.decorator';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { AdminService } from './admin.service';

/** 账户角色：普通管理员 / 超级管理员（超管不可被普通管理员创建或越权操作）。 */
const roleEnum = z.enum(['admin', 'super_admin']);

/** 新建账户入参：身份 + 初始口令 + 角色 + 能力清单。 */
const createUserSchema = z.object({
  /** 登录邮箱，非空 */
  email: z.string().trim().min(1),
  /** 展示用姓名，非空 */
  name: z.string().trim().min(1),
  /** 角色；省略服务内默认 admin */
  role: roleEnum.optional(),
  /** 初始口令明文 */
  password: z.string(),
  /** 是否强制首次登录改密；省略=false */
  requireChange: z.boolean().optional(),
  /** 勾选的能力 key 列表（RBAC）；省略=无额外能力 */
  perms: z.array(z.string()).optional(),
});

/** 编辑账户入参：改姓名 / 角色 / 能力（不含口令、状态——各有独立端点）。 */
const editUserSchema = z.object({
  /** 改展示姓名，非空 */
  name: z.string().trim().min(1),
  /** 改角色；省略服务内默认 admin */
  role: roleEnum.optional(),
  /** 改能力 key 列表（整体覆盖）；省略=清空额外能力 */
  perms: z.array(z.string()).optional(),
});

/** 启停账户入参。 */
const statusSchema = z.object({
  /** 目标状态：active 启用 / disabled 停用（停用即吊销其会话） */
  status: z.enum(['active', 'disabled']),
});

/**
 * /api/admin/* —— 账户 / 权限管理（需 accounts:manage）。
 * 写方法由全局会话守卫强制 CSRF 头；超管层级 / 最后一个超管等业务校验在 AdminService。
 */
@RequirePermission('accounts:manage')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  listUsers() {
    return this.admin.listUsers();
  }

  @Post('users')
  @HttpCode(201)
  createUser(
    @AuthUser() actor: AuthedUser,
    @Body(new ZodValidationPipe(createUserSchema)) dto: z.infer<typeof createUserSchema>,
  ) {
    return this.admin.createUser(actor, {
      email: dto.email,
      name: dto.name,
      role: dto.role ?? 'admin',
      password: dto.password,
      requireChange: dto.requireChange ?? false,
      perms: dto.perms ?? [],
    });
  }

  @Patch('users/:id')
  async editUser(
    @AuthUser() actor: AuthedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(editUserSchema)) dto: z.infer<typeof editUserSchema>,
  ): Promise<{ ok: true }> {
    await this.admin.editUser(actor, id, {
      name: dto.name,
      role: dto.role ?? 'admin',
      perms: dto.perms ?? [],
    });

    return { ok: true };
  }

  @Delete('users/:id')
  async deleteUser(@AuthUser() actor: AuthedUser, @Param('id') id: string): Promise<{ ok: true }> {
    await this.admin.deleteUser(actor, id);

    return { ok: true };
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  resetPassword(@AuthUser() actor: AuthedUser, @Param('id') id: string) {
    return this.admin.resetPassword(actor, id);
  }

  @Post('users/:id/status')
  @HttpCode(200)
  async setStatus(
    @AuthUser() actor: AuthedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema)) dto: z.infer<typeof statusSchema>,
  ): Promise<{ ok: true }> {
    await this.admin.setStatus(actor, id, dto.status);

    return { ok: true };
  }
}
