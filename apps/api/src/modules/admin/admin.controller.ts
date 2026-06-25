import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthedUser } from '@/types/auth-context';
import { AuthUser, RequirePermission } from '@/common/auth-user.decorator';
import { parsePage, trimmed } from '@/utils/query-parse';
import { AdminService } from './admin.service';
import { CreateUserDto, EditUserDto, StatusDto } from './admin.schema';

/**
 * /api/admin/* —— 账户 / 权限管理（需 accounts:manage）。
 * 写方法由全局会话守卫强制 CSRF 头；超管层级 / 最后一个超管等业务校验在 AdminService。
 */
@ApiTags('admin')
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

  @Get('audit')
  @RequirePermission('audit:view')
  listAudit(@Query() q: Record<string, string | undefined>) {
    return this.admin.listAudit({ q: trimmed(q.q), page: parsePage(q.page) });
  }

  @Post('users')
  @HttpCode(201)
  createUser(@AuthUser() actor: AuthedUser, @Body() dto: CreateUserDto) {
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
    @Body() dto: EditUserDto,
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
    @Body() dto: StatusDto,
  ): Promise<{ ok: true }> {
    await this.admin.setStatus(actor, id, dto.status);

    return { ok: true };
  }
}
