import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@/auth';
import {
  isPermissionKey,
  type AdminUserRow,
  type PermissionKey,
  type UserRole,
} from '@hatch-radar/shared';
import type { AuthedUser } from '@/types/auth-context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/common/errors';
import { AuditLogsRepository } from '@/database';
import { SessionsRepository } from '@/database';
import { UsersRepository } from '@/database';
import { nowSec } from '@/utils/time';

/** 新建账户入参（来自控制器 DTO）。 */
export interface CreateUserDto {
  /** 登录邮箱（服务内会 trim + 小写化） */
  email: string;
  /** 显示姓名 */
  name: string;
  /** 角色：super_admin / admin */
  role: UserRole;
  /** 初始密码明文（至少 8 位；服务内 hash 后入库） */
  password: string;
  /** 是否强制其首次登录改密 */
  requireChange: boolean;
  /** 勾选的能力 key（仅 admin 角色生效；超管隐含全权） */
  perms: string[];
}

/** 编辑账户入参。 */
export interface EditUserDto {
  /** 显示姓名 */
  name: string;
  /** 角色：super_admin / admin */
  role: UserRole;
  /** 勾选的能力 key（仅 admin 角色生效） */
  perms: string[];
}

function tempPassword(): string {
  return randomBytes(9).toString('base64url');
}

/**
 * 账户管理服务（后端归一 P2：原 web lib/admin/* 整体迁来，行为不变）。
 *
 * 能力闸（accounts:manage）由控制器的 SessionAuthGuard + @RequirePermission 强制；
 * 本服务只做「超管层级 / 最后一个超管 / 不能操作自己」等业务校验与审计，校验失败抛 HttpException。
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly audit: AuditLogsRepository,
  ) {}

  // ── 读 ────────────────────────────────────────────────────────────────

  /** 全部管理员账户（管理页列表用）。 */
  listUsers(): Promise<AdminUserRow[]> {
    return this.users.listForAdmin();
  }

  // ── 账户写 ──────────────────────────────────────────────────────────────

  /**
   * 新建管理员账户。
   * @param actor 操作者（当前登录管理员，用于层级校验与审计）
   * @param dto 新账户字段（见 {@link CreateUserDto}）
   * @returns 新账户 id
   * @throws ValidationError 邮箱 / 姓名为空，或初始密码不足 8 位
   * @throws ForbiddenError 非超管试图创建超管
   * @throws ConflictError 邮箱已存在
   */
  async createUser(actor: AuthedUser, dto: CreateUserDto): Promise<{ id: string }> {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    if (!email || !name) {
      throw new ValidationError('邮箱与姓名必填');
    }

    if (dto.password.length < 8) {
      throw new ValidationError('初始密码至少 8 位');
    }

    if (dto.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new ForbiddenError('只有超级管理员能创建超级管理员');
    }

    if (await this.users.findByEmail(email)) {
      throw new ConflictError('该邮箱已存在');
    }

    const perms = dto.role === 'admin' ? this.sanitizePermissions(actor, dto.perms) : [];
    const id = await this.users.create(
      {
        email,
        name,
        passwordHash: await hashPassword(dto.password),
        role: dto.role,
        mustChangePassword: dto.requireChange,
        createdBy: actor.id,
        permissions: perms,
        grantedBy: actor.id,
      },
      nowSec(),
    );
    await this.audit.write({
      actorId: actor.id,
      action: 'account.create',
      targetType: 'user',
      targetId: id,
      metadata: { email, role: dto.role, permissions: perms },
    });

    return { id };
  }

  /**
   * 编辑管理员资料 / 角色 / 权限。
   * @param actor 操作者（当前登录管理员）
   * @param userId 被编辑账户 id
   * @param dto 资料 / 角色 / 权限（见 {@link EditUserDto}）
   * @throws ValidationError 姓名为空，或试图降级最后一个超管
   * @throws NotFoundError 账户不存在
   * @throws ForbiddenError 非超管试图授予超管角色，或操作他人账户
   */
  async editUser(actor: AuthedUser, userId: string, dto: EditUserDto): Promise<void> {
    const name = dto.name.trim();
    if (!name) {
      throw new ValidationError('参数不完整');
    }

    const target = await this.users.findById(userId);
    if (!target) {
      throw new NotFoundError('账户不存在');
    }

    this.assertCanManageTarget(actor, userId);
    if (dto.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new ForbiddenError('只有超级管理员能授予超管角色');
    }

    if (
      target.role === 'super_admin' &&
      dto.role !== 'super_admin' &&
      (await this.isLastActiveSuper(userId))
    ) {
      throw new ValidationError('不能降级最后一个超级管理员');
    }

    const perms = dto.role === 'admin' ? this.sanitizePermissions(actor, dto.perms) : [];
    await this.users.updateProfileAndPermissions(
      userId,
      { name, role: dto.role },
      perms,
      actor.id,
      nowSec(),
    );
    await this.audit.write({
      actorId: actor.id,
      action: 'account.update',
      targetType: 'user',
      targetId: userId,
      metadata: { name, role: dto.role, permissions: perms },
    });
  }

  /**
   * 重置某账户密码为随机临时密码，强制其首登改密并踢下线。
   * @param actor 操作者（当前登录管理员）
   * @param userId 被重置账户 id
   * @returns 一次性临时密码（仅此次返回明文）
   * @throws NotFoundError 账户不存在
   * @throws ForbiddenError 非超管操作他人账户
   */
  async resetPassword(actor: AuthedUser, userId: string): Promise<{ tempPassword: string }> {
    const target = await this.users.findById(userId);
    if (!target) {
      throw new NotFoundError('账户不存在');
    }

    this.assertCanManageTarget(actor, userId);
    const pw = tempPassword();
    await this.users.updatePassword(userId, await hashPassword(pw), true, nowSec());
    await this.sessions.deleteByUser(userId);
    await this.audit.write({
      actorId: actor.id,
      action: 'account.password.reset',
      targetType: 'user',
      targetId: userId,
    });

    return { tempPassword: pw };
  }

  /**
   * 启用 / 停用账户（停用即踢下线）。
   * @param actor 操作者（当前登录管理员）
   * @param userId 目标账户 id
   * @param status 目标状态：active 启用 / disabled 停用
   * @throws ValidationError 操作自己，或停用最后一个超管
   * @throws NotFoundError 账户不存在
   * @throws ForbiddenError 非超管操作他人账户
   */
  async setStatus(actor: AuthedUser, userId: string, status: 'active' | 'disabled'): Promise<void> {
    if (userId === actor.id) {
      throw new ValidationError('不能停用 / 启用自己');
    }

    const target = await this.users.findById(userId);
    if (!target) {
      throw new NotFoundError('账户不存在');
    }

    this.assertCanManageTarget(actor, userId);
    if (status === 'disabled' && (await this.isLastActiveSuper(userId))) {
      throw new ValidationError('不能停用最后一个超级管理员');
    }

    await this.users.setStatus(userId, status, nowSec());
    if (status === 'disabled') {
      await this.sessions.deleteByUser(userId);
    }

    await this.audit.write({
      actorId: actor.id,
      action: status === 'disabled' ? 'account.disable' : 'account.enable',
      targetType: 'user',
      targetId: userId,
    });
  }

  /**
   * 删除账户（级联清理其权限 / 会话 / 设备）。
   * @param actor 操作者（当前登录管理员）
   * @param userId 被删除账户 id
   * @throws ValidationError 删除自己，或删除最后一个超管
   * @throws NotFoundError 账户不存在
   * @throws ForbiddenError 非超管操作他人账户
   */
  async deleteUser(actor: AuthedUser, userId: string): Promise<void> {
    if (userId === actor.id) {
      throw new ValidationError('不能删除自己');
    }

    const target = await this.users.findById(userId);
    if (!target) {
      throw new NotFoundError('账户不存在');
    }

    this.assertCanManageTarget(actor, userId);
    if (await this.isLastActiveSuper(userId)) {
      throw new ValidationError('不能删除最后一个超级管理员');
    }

    await this.users.delete(userId);
    await this.audit.write({
      actorId: actor.id,
      action: 'account.delete',
      targetType: 'user',
      targetId: userId,
      metadata: { email: target.email },
    });
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  /**
   * 目标账户操作授权：超管可操作任何账户；非超管（普通管理员）只能操作自己——不可对任何其它账户
   * （含平级管理员）做 编辑 / 重置密码 / 停用 / 删除 / 赋予设备 / 吊销设备。堵死「持 accounts:manage
   * 的普通管理员重置其它管理员密码接管账户」这一越权（sanitizePermissions 只挡了授予越权、未挡操作平级）。
   */
  private assertCanManageTarget(actor: AuthedUser, targetUserId: string): void {
    if (actor.role === 'super_admin') {
      return;
    } // 超管全通（仍受「最后一个超管」等单独校验约束）

    if (targetUserId !== actor.id) {
      throw new ForbiddenError('只有超级管理员能管理其它账户');
    }
  }

  /** 把请求的权限收敛为合法 key；非超管 actor 限制在其自身拥有的能力内（不能授予自己没有的）。 */
  private sanitizePermissions(actor: AuthedUser, requested: string[]): PermissionKey[] {
    const valid = requested.filter(isPermissionKey);
    if (actor.role === 'super_admin') {
      return [...new Set(valid)];
    }

    const own = new Set(actor.permissions);

    return [...new Set(valid.filter((p) => own.has(p)))];
  }

  /** 目标是否为「最后一个启用中的超级管理员」（用于阻止停用/删除/降级）。 */
  private async isLastActiveSuper(userId: string): Promise<boolean> {
    const t = await this.users.findById(userId);
    if (!t || t.role !== 'super_admin' || t.status !== 'active') {
      return false;
    }

    return (await this.users.countActiveSupers()) <= 1;
  }
}
