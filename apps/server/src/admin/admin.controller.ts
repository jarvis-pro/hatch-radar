import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, RequirePermission, type AuthedUser } from '@/account/auth-user.decorator';
import { SessionAuthGuard } from '@/account/session-auth.guard';
import { ZodValidationPipe } from '@/common/zod-validation.pipe';
import { AdminService } from '@hatch-radar/core';

const roleEnum = z.enum(['admin', 'super_admin']);

const createUserSchema = z.object({
  email: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: roleEnum.optional(),
  password: z.string(),
  requireChange: z.boolean().optional(),
  perms: z.array(z.string()).optional(),
});

const editUserSchema = z.object({
  name: z.string().trim().min(1),
  role: roleEnum.optional(),
  perms: z.array(z.string()).optional(),
});

const statusSchema = z.object({ status: z.enum(['active', 'disabled']) });

const enrollmentSchema = z.object({
  deviceName: z.string().trim().min(1),
  ttlDays: z.coerce.number().int(),
});

/**
 * /api/admin/* —— 账户 / 权限 / 设备管理（需 accounts:manage）。
 * 写方法由 SessionAuthGuard 强制 CSRF 头；超管层级 / 最后一个超管等业务校验在 AdminService。
 */
@UseGuards(SessionAuthGuard)
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

  @Get('devices')
  listDevices() {
    return this.admin.listDevices();
  }

  @Get('enrollments')
  listEnrollments() {
    return this.admin.listEnrollments();
  }

  @Post('users/:id/enrollments')
  @HttpCode(201)
  createEnrollment(
    @AuthUser() actor: AuthedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(enrollmentSchema)) dto: z.infer<typeof enrollmentSchema>,
  ) {
    return this.admin.createEnrollment(actor, id, dto.deviceName, dto.ttlDays);
  }

  @Delete('devices/:id')
  async revokeDevice(
    @AuthUser() actor: AuthedUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.admin.revokeDevice(actor, id);
    return { ok: true };
  }

  @Delete('enrollments/:id')
  async cancelEnrollment(
    @AuthUser() actor: AuthedUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.admin.cancelEnrollment(actor, id);
    return { ok: true };
  }
}
