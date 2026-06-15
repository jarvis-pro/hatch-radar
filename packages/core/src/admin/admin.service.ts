import { randomBytes } from 'node:crypto';
import { generateEnrollmentCode, hashPassword, sha256Hex } from '@hatch-radar/auth';
import {
  isPermissionKey,
  type AdminUserRow,
  type DeviceRow,
  type EnrollmentRow,
  type PermissionKey,
  type UserRole,
} from '@hatch-radar/shared';
import type { AuthedUser } from '../account/auth-context';
import { DomainError } from '../errors';
import { AuditLogsRepository } from '../db/audit-logs.repository';
import { DeviceCredentialsRepository } from '../db/device-credentials.repository';
import { DeviceEnrollmentsRepository } from '../db/device-enrollments.repository';
import { SessionsRepository } from '../db/sessions.repository';
import { UsersRepository } from '../db/users.repository';
import { nowSec } from '../utils/time';

/** 激活码有效期（秒）：短，15 分钟。 */
const ENROLL_TTL_SEC = 15 * 60;
/** 允许的离线宽限窗（天）。 */
const ALLOWED_TTL_DAYS = [7, 30, 60];

/** 新建账户入参（来自控制器 DTO）。 */
export interface CreateUserDto {
  email: string;
  name: string;
  role: UserRole;
  password: string;
  requireChange: boolean;
  perms: string[];
}

/** 编辑账户入参。 */
export interface EditUserDto {
  name: string;
  role: UserRole;
  perms: string[];
}

function tempPassword(): string {
  return randomBytes(9).toString('base64url');
}

/**
 * 账户 / 设备管理服务（后端归一 P2：原 web lib/admin/* 整体迁来，行为不变）。
 *
 * 能力闸（accounts:manage）由控制器的 SessionAuthGuard + @RequirePermission 强制；
 * 本服务只做「超管层级 / 最后一个超管 / 不能操作自己」等业务校验与审计，校验失败抛 HttpException。
 */
export class AdminService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly devices: DeviceCredentialsRepository,
    private readonly enrollments: DeviceEnrollmentsRepository,
    private readonly audit: AuditLogsRepository,
  ) {}

  // ── 读 ────────────────────────────────────────────────────────────────

  listUsers(): Promise<AdminUserRow[]> {
    return this.users.listForAdmin();
  }

  listDevices(): Promise<DeviceRow[]> {
    return this.devices.listAll();
  }

  listEnrollments(): Promise<EnrollmentRow[]> {
    return this.enrollments.listPending(nowSec());
  }

  // ── 账户写 ──────────────────────────────────────────────────────────────

  /** 新建管理员。 */
  async createUser(actor: AuthedUser, dto: CreateUserDto): Promise<{ id: string }> {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    if (!email || !name) throw new DomainError('邮箱与姓名必填', 400);
    if (dto.password.length < 8) throw new DomainError('初始密码至少 8 位', 400);
    if (dto.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('只有超级管理员能创建超级管理员', 403);
    }
    if (await this.users.findByEmail(email)) throw new DomainError('该邮箱已存在', 409);
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

  /** 编辑管理员资料 / 角色 / 权限。 */
  async editUser(actor: AuthedUser, userId: string, dto: EditUserDto): Promise<void> {
    const name = dto.name.trim();
    if (!name) throw new DomainError('参数不完整', 400);
    const target = await this.users.findById(userId);
    if (!target) throw new DomainError('账户不存在', 404);
    if (target.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('只有超级管理员能管理超级管理员', 403);
    }
    if (dto.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('只有超级管理员能授予超管角色', 403);
    }
    if (
      target.role === 'super_admin' &&
      dto.role !== 'super_admin' &&
      (await this.isLastActiveSuper(userId))
    ) {
      throw new DomainError('不能降级最后一个超级管理员', 400);
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

  /** 重置某账户密码为随机临时密码，强制首登改密、踢下线。返回临时密码（仅此一次）。 */
  async resetPassword(actor: AuthedUser, userId: string): Promise<{ tempPassword: string }> {
    const target = await this.users.findById(userId);
    if (!target) throw new DomainError('账户不存在', 404);
    if (target.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('只有超级管理员能重置超级管理员密码', 403);
    }
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

  /** 启用 / 停用账户（停用即踢下线）。 */
  async setStatus(actor: AuthedUser, userId: string, status: 'active' | 'disabled'): Promise<void> {
    if (userId === actor.id) throw new DomainError('不能停用 / 启用自己', 400);
    const target = await this.users.findById(userId);
    if (!target) throw new DomainError('账户不存在', 404);
    if (target.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('只有超级管理员能管理超级管理员', 403);
    }
    if (status === 'disabled' && (await this.isLastActiveSuper(userId))) {
      throw new DomainError('不能停用最后一个超级管理员', 400);
    }
    await this.users.setStatus(userId, status, nowSec());
    if (status === 'disabled') await this.sessions.deleteByUser(userId);
    await this.audit.write({
      actorId: actor.id,
      action: status === 'disabled' ? 'account.disable' : 'account.enable',
      targetType: 'user',
      targetId: userId,
    });
  }

  /** 删除账户（级联清理其权限 / 会话 / 设备）。 */
  async deleteUser(actor: AuthedUser, userId: string): Promise<void> {
    if (userId === actor.id) throw new DomainError('不能删除自己', 400);
    const target = await this.users.findById(userId);
    if (!target) throw new DomainError('账户不存在', 404);
    if (target.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('只有超级管理员能删除超级管理员', 403);
    }
    if (await this.isLastActiveSuper(userId)) {
      throw new DomainError('不能删除最后一个超级管理员', 400);
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

  // ── 设备写 ──────────────────────────────────────────────────────────────

  /** 为某用户「赋予设备」：生成一次性激活码（仅此次返回明文，库存 sha256）。 */
  async createEnrollment(
    actor: AuthedUser,
    userId: string,
    deviceName: string,
    ttlDays: number,
  ): Promise<{ code: string }> {
    const name = deviceName.trim();
    if (!name) throw new DomainError('请填写设备名', 400);
    const ttl = ALLOWED_TTL_DAYS.includes(ttlDays) ? ttlDays : 30;
    const target = await this.users.findById(userId);
    if (!target) throw new DomainError('账户不存在', 404);
    if (target.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('只有超级管理员能为超级管理员赋予设备', 403);
    }
    const code = generateEnrollmentCode();
    const now = nowSec();
    const id = await this.enrollments.create({
      userId,
      deviceName: name,
      codeHash: sha256Hex(code),
      ttlDays: ttl,
      expiresAt: now + ENROLL_TTL_SEC,
      issuedBy: actor.id,
      now,
    });
    await this.audit.write({
      actorId: actor.id,
      action: 'device.enroll.provision',
      targetType: 'user',
      targetId: userId,
      metadata: { enrollmentId: id, deviceName: name, ttlDays: ttl },
    });
    return { code };
  }

  /** 强踢：吊销某设备凭据（下次验签即被拒）。 */
  async revokeDevice(actor: AuthedUser, credentialId: string): Promise<void> {
    const cred = await this.devices.findByIdWithOwnerRole(credentialId);
    if (!cred) throw new DomainError('设备不存在', 404);
    if (cred.ownerRole === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('只有超级管理员能管理超级管理员的设备', 403);
    }
    await this.devices.revoke(credentialId);
    await this.audit.write({
      actorId: actor.id,
      action: 'device.revoke',
      targetType: 'device',
      targetId: credentialId,
      metadata: { user_id: cred.userId },
    });
  }

  /** 取消一个待激活的激活码。 */
  async cancelEnrollment(actor: AuthedUser, enrollmentId: string): Promise<void> {
    await this.enrollments.cancel(enrollmentId);
    await this.audit.write({
      actorId: actor.id,
      action: 'device.enroll.cancel',
      targetType: 'enrollment',
      targetId: enrollmentId,
    });
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  /** 把请求的权限收敛为合法 key；非超管 actor 限制在其自身拥有的能力内（不能授予自己没有的）。 */
  private sanitizePermissions(actor: AuthedUser, requested: string[]): PermissionKey[] {
    const valid = requested.filter(isPermissionKey);
    if (actor.role === 'super_admin') return [...new Set(valid)];
    const own = new Set(actor.permissions);
    return [...new Set(valid.filter((p) => own.has(p)))];
  }

  /** 目标是否为「最后一个启用中的超级管理员」（用于阻止停用/删除/降级）。 */
  private async isLastActiveSuper(userId: string): Promise<boolean> {
    const t = await this.users.findById(userId);
    if (!t || t.role !== 'super_admin' || t.status !== 'active') return false;
    return (await this.users.countActiveSupers()) <= 1;
  }
}
