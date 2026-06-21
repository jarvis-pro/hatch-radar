import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/common/tokens';
import {
  isPermissionKey,
  type AdminUserRow,
  type PermissionKey,
  type UserRole,
} from '@hatch-radar/shared';
import { type AppDatabase } from '../internal';

/** 解析会话 / 校验密码时所需的用户视图（含密码哈希与已加载权限）。 */
export interface UserAuthView {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  role: UserRole;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  passwordHash: string;
  permissions: PermissionKey[];
}

/** users 行（含 permissions 关系）→ UserAuthView。 */
function toAuthView(u: {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  role: string;
  status: 'active' | 'disabled';
  must_change_password: boolean;
  password_hash: string;
  permissions: { permission: string }[];
}): UserAuthView {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    role: u.role as UserRole,
    status: u.status,
    mustChangePassword: u.must_change_password,
    passwordHash: u.password_hash,
    permissions: u.permissions.map((p) => p.permission).filter(isPermissionKey),
  };
}

/** 新建账户的入参（密码已哈希）。 */
export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
  createdBy: string | null;
  permissions: PermissionKey[];
  grantedBy: string | null;
}

/**
 * 用户聚合数据访问（users + user_permissions 视为同一聚合，一并增删改）。
 * 业务策略（限流 / 层级校验 / 审计）留在 AccountService / AdminService，本类只做数据存取。
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /** 按邮箱取原始行（登录用，需要 password_hash / status）。 */
  findByEmail(email: string) {
    return this.db.users.findUnique({ where: { email } });
  }

  /** 按 id 取原始行（改密 / 管理操作的前置校验用）。 */
  findById(id: string) {
    return this.db.users.findUnique({ where: { id } });
  }

  /** 会话解析用：按 id 取用户 + 已加载权限，含密码哈希。不存在返回 null。 */
  async resolveWithPermissions(id: string): Promise<UserAuthView | null> {
    const u = await this.db.users.findUnique({ where: { id }, include: { permissions: true } });
    return u ? toAuthView(u) : null;
  }

  /** 登录用：按邮箱取用户 + 已加载权限，含密码哈希。不存在返回 null。 */
  async findAuthViewByEmail(email: string): Promise<UserAuthView | null> {
    const u = await this.db.users.findUnique({ where: { email }, include: { permissions: true } });
    return u ? toAuthView(u) : null;
  }

  /** 账户总数（首超管种子的空库判定）。 */
  count(): Promise<number> {
    return this.db.users.count();
  }

  /** 启用中的超级管理员数量（阻止停用 / 删除 / 降级最后一个超管）。 */
  countActiveSupers(): Promise<number> {
    return this.db.users.count({ where: { role: 'super_admin', status: 'active' } });
  }

  /** 登录成功后回填最近登录时间。 */
  async updateLastLogin(id: string, now: number): Promise<void> {
    await this.db.users.update({ where: { id }, data: { last_login_at: BigInt(now) } });
  }

  /** 改密 / 重置密码：写新哈希 + 强制改密标记。 */
  async updatePassword(
    id: string,
    passwordHash: string,
    mustChangePassword: boolean,
    now: number,
  ): Promise<void> {
    await this.db.users.update({
      where: { id },
      data: {
        password_hash: passwordHash,
        must_change_password: mustChangePassword,
        updated_at: BigInt(now),
      },
    });
  }

  /** 改本人姓名。 */
  async updateName(id: string, name: string, now: number): Promise<void> {
    await this.db.users.update({ where: { id }, data: { name, updated_at: BigInt(now) } });
  }

  /** 改本人头像（avatar=DiceBear seed；null 恢复姓名首字母）。 */
  async updateAvatar(id: string, avatar: string | null, now: number): Promise<void> {
    await this.db.users.update({ where: { id }, data: { avatar, updated_at: BigInt(now) } });
  }

  /** 启用 / 停用账户。 */
  async setStatus(id: string, status: 'active' | 'disabled', now: number): Promise<void> {
    await this.db.users.update({ where: { id }, data: { status, updated_at: BigInt(now) } });
  }

  /** 新建账户（连同初始权限，单事务）。返回新建 id。 */
  async create(input: CreateUserInput, now: number): Promise<string> {
    const ts = BigInt(now);
    const user = await this.db.users.create({
      data: {
        email: input.email,
        name: input.name,
        password_hash: input.passwordHash,
        role: input.role,
        status: 'active',
        must_change_password: input.mustChangePassword,
        created_by: input.createdBy,
        created_at: ts,
        updated_at: ts,
        permissions: input.permissions.length
          ? {
              create: input.permissions.map((p) => ({
                permission: p,
                granted_by: input.grantedBy,
                granted_at: ts,
              })),
            }
          : undefined,
      },
    });
    return user.id;
  }

  /** 编辑资料 / 角色 / 权限（替换式：清空旧权限再写新权限，单事务）。 */
  async updateProfileAndPermissions(
    id: string,
    fields: { name: string; role: UserRole },
    permissions: PermissionKey[],
    grantedBy: string | null,
    now: number,
  ): Promise<void> {
    const ts = BigInt(now);
    await this.db.$transaction([
      this.db.users.update({
        where: { id },
        data: { name: fields.name, role: fields.role, updated_at: ts },
      }),
      this.db.user_permissions.deleteMany({ where: { user_id: id } }),
      ...(permissions.length
        ? [
            this.db.user_permissions.createMany({
              data: permissions.map((p) => ({
                user_id: id,
                permission: p,
                granted_by: grantedBy,
                granted_at: ts,
              })),
            }),
          ]
        : []),
    ]);
  }

  /** 删除账户（user_permissions / sessions / 设备等按 schema 级联清理）。 */
  async delete(id: string): Promise<void> {
    await this.db.users.delete({ where: { id } });
  }

  /** 账户管理列表（超管在前，再按创建时间），含权限与设备数。 */
  async listForAdmin(): Promise<AdminUserRow[]> {
    const rows = await this.db.users.findMany({
      include: { permissions: true, _count: { select: { devices: true } } },
      orderBy: [{ role: 'asc' }, { created_at: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role as UserRole,
      status: r.status,
      mustChangePassword: r.must_change_password,
      permissions: r.permissions.map((p) => p.permission).filter(isPermissionKey),
      deviceCount: r._count.devices,
      lastLoginAt: r.last_login_at != null ? Number(r.last_login_at) : null,
      createdAt: Number(r.created_at),
    }));
  }
}
