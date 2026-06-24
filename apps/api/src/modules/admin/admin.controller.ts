import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthedUser } from '@/types/auth-context';
import { AuthUser, RequirePermission } from '@/common/auth-user.decorator';
import { ZodBody } from '@/common/zod-body.decorator';
import { parsePage, trimmed } from '@/common/query-parse';
import { AdminService } from './admin.service';
import { createUserSchema, editUserSchema, statusSchema } from './admin.schema';
import type { CreateUserDto, EditUserDto, StatusDto } from './admin.schema';

/**
 * /api/admin/* —— 账户 / 权限管理（需 accounts:manage）。
 * 写方法由全局会话守卫强制 CSRF 头；超管层级 / 最后一个超管等业务校验在 AdminService。
 */
@RequirePermission('accounts:manage')
@Controller('admin')
export class AdminController {
  constructor(
    // 账户管理领域服务：建/改/删用户、重置密码、启停账户
    private readonly admin: AdminService,
  ) {}

  @Get('users')
  listUsers() {
    return this.admin.listUsers();
  }

  /** GET /api/admin/audit —— 审计日志分页（需 audit:view，方法级覆盖类级 accounts:manage）。 */
  @Get('audit')
  @RequirePermission('audit:view')
  listAudit(@Query() q: Record<string, string | undefined>) {
    return this.admin.listAudit({ q: trimmed(q.q), page: parsePage(q.page) });
  }

  @Post('users')
  @HttpCode(201)
  createUser(@AuthUser() actor: AuthedUser, @ZodBody(createUserSchema) dto: CreateUserDto) {
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
    @ZodBody(editUserSchema) dto: EditUserDto,
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
    @ZodBody(statusSchema) dto: StatusDto,
  ): Promise<{ ok: true }> {
    await this.admin.setStatus(actor, id, dto.status);

    return { ok: true };
  }
}
