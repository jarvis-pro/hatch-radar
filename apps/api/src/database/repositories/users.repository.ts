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
  /** 登录邮箱 */
  email: string;
  /** 显示姓名 */
  name: string;
  /** DiceBear 头像 seed；null 用姓名首字母 */
  avatar: string | null;
  /** 角色：super_admin / admin */
  role: UserRole;
  /** 账户状态：active 正常 / disabled 已停用（拒登录并踢会话） */
  status: 'active' | 'disabled';
  /** 是否需在下次登录后强制改密 */
  mustChangePassword: boolean;
  /** scrypt 密码哈希（绝不外发；脱敏在 service 边界完成） */
  passwordHash: string;
  /** 已加载并过滤为合法 key 的能力清单 */
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
  /** 登录邮箱 */
  email: string;
  /** 显示姓名 */
  name: string;
  /** 已 scrypt 哈希的密码（明文哈希在 service 完成） */
  passwordHash: string;
  /** 角色：super_admin / admin */
  role: UserRole;
  /** 是否强制其首次登录改密 */
  mustChangePassword: boolean;
  /** 创建者 users.id；系统种子为 null */
  createdBy: string | null;
  /** 初始能力清单（仅 admin 角色有意义） */
  permissions: PermissionKey[];
  /** 授予上述权限的操作者 users.id；系统种子为 null */
  grantedBy: string | null;
}

/**
 * 用户聚合数据访问（users + user_permissions 视为同一聚合，一并增删改）。
 * 业务策略（限流 / 层级校验 / 审计）留在 AccountService / AdminService，本类只做数据存取。
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(PRISMA) private readonly db: AppDatabase) {}

  /**
   * 按邮箱取原始行（登录用，需要 password_hash / status）。
   * @param email 登录邮箱
   */
  findByEmail(email: string) {
    return this.db.users.findUnique({ where: { email } });
  }

  /**
   * 按 id 取原始行（改密 / 管理操作的前置校验用）。
   * @param id 用户 id
   */
  findById(id: string) {
    return this.db.users.findUnique({ where: { id } });
  }

  /**
   * 会话解析用：按 id 取用户 + 已加载权限，含密码哈希。不存在返回 null。
   * @param id 用户 id
   */
  async resolveWithPermissions(id: string): Promise<UserAuthView | null> {
    const u = await this.db.users.findUnique({ where: { id }, include: { permissions: true } });

    return u ? toAuthView(u) : null;
  }

  /**
   * 登录用：按邮箱取用户 + 已加载权限，含密码哈希。不存在返回 null。
   * @param email 登录邮箱
   */
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

  /**
   * 登录成功后回填最近登录时间。
   * @param id 用户 id
   * @param now 登录时刻 Unix 时间戳（秒）
   */
  async updateLastLogin(id: string, now: number): Promise<void> {
    await this.db.users.update({ where: { id }, data: { last_login_at: BigInt(now) } });
  }

  /**
   * 改密 / 重置密码：写新哈希 + 强制改密标记。
   * @param id 用户 id
   * @param passwordHash 新密码的 scrypt 哈希
   * @param mustChangePassword 是否要求下次登录改密（重置时为 true）
   * @param now 更新时刻 Unix 时间戳（秒）
   */
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

  /**
   * 改本人姓名。
   * @param id 用户 id
   * @param name 新姓名
   * @param now 更新时刻 Unix 时间戳（秒）
   */
  async updateName(id: string, name: string, now: number): Promise<void> {
    await this.db.users.update({ where: { id }, data: { name, updated_at: BigInt(now) } });
  }

  /**
   * 改本人头像（avatar=DiceBear seed；null 恢复姓名首字母）。
   * @param id 用户 id
   * @param avatar DiceBear seed；传 null 恢复姓名首字母
   * @param now 更新时刻 Unix 时间戳（秒）
   */
  async updateAvatar(id: string, avatar: string | null, now: number): Promise<void> {
    await this.db.users.update({ where: { id }, data: { avatar, updated_at: BigInt(now) } });
  }

  /**
   * 启用 / 停用账户。
   * @param id 用户 id
   * @param status 目标状态：active 启用 / disabled 停用
   * @param now 更新时刻 Unix 时间戳（秒）
   */
  async setStatus(id: string, status: 'active' | 'disabled', now: number): Promise<void> {
    await this.db.users.update({ where: { id }, data: { status, updated_at: BigInt(now) } });
  }

  /**
   * 新建账户（连同初始权限，单事务）。
   * @param input 账户字段 + 初始权限（见 {@link CreateUserInput}）
   * @param now 创建时刻 Unix 时间戳（秒）
   * @returns 新建账户 id
   */
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

  /**
   * 编辑资料 / 角色 / 权限（替换式：清空旧权限再写新权限，单事务）。
   * @param id 用户 id
   * @param fields 姓名 + 角色
   * @param permissions 新的能力清单（整表替换）
   * @param grantedBy 授权操作者 id；系统为 null
   * @param now 更新时刻 Unix 时间戳（秒）
   */
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

  /**
   * 删除账户（user_permissions / sessions 按 schema 级联清理）。
   * @param id 用户 id
   */
  async delete(id: string): Promise<void> {
    await this.db.users.delete({ where: { id } });
  }

  /** 账户管理列表（超管在前，再按创建时间），含权限。 */
  async listForAdmin(): Promise<AdminUserRow[]> {
    const rows = await this.db.users.findMany({
      include: { permissions: true },
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
      lastLoginAt: r.last_login_at != null ? Number(r.last_login_at) : null,
      createdAt: Number(r.created_at),
    }));
  }
}
