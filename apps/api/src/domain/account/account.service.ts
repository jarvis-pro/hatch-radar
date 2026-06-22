import { Injectable } from '@nestjs/common';
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from '@/auth';
import type { CurrentUser, SessionInfo } from '@hatch-radar/shared';
import { RuntimeSettingsService } from '../settings/runtime-settings.service';
import { AuditLogsRepository } from '@/database';
import { LoginAttemptsRepository } from '@/database';
import { SessionsRepository } from '@/database';
import { UsersRepository, type UserAuthView } from '@/database';
import { TxContext } from '@/database';
import {
  DomainError,
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '@/domain/errors';
import { logger } from '@/logger';
import { nowSec } from '@/utils/time';
import type { AuthedUser } from './auth-context';

/** 把被兜底成 503 的意外错误（DB 抖动 / 约束冲突等）的根因落日志——否则「服务暂时不可用」在日志里无迹可循。 */
function logUnexpected(scope: string, e: unknown): void {
  logger.error(
    `[account] ${scope} 异常：${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  );
}

const DAY = 86_400;
/** 滑动续期写库的最小间隔（秒）：last_seen 在此区间内不重复 update，省写。 */
const SLIDE_THROTTLE = 60;
/** 滑动窗内达到此失败次数即锁定。 */
const MAX_FAILURES = 5;
/** 滑动窗（秒）：上次失败超过此时长则失败计数从头算。 */
const WINDOW_SEC = 900;
/** 锁定时长（秒）。 */
const LOCK_SEC = 300;

/** 登录请求附带的客户端信息（写入会话与审计）。 */
export interface LoginMeta {
  userAgent?: string;
  ip?: string;
}

/**
 * 登录成功结果：token（控制器据此 Set-Cookie）+ 用户态 + cookie 绝对生命周期（天）。
 * 失败一律抛 DomainError。absoluteDays 随运行期设置可变，故由服务回传而非控制器自取。
 */
export type LoginResult = { token: string; user: CurrentUser; absoluteDays: number };

function stripHash(view: UserAuthView): CurrentUser {
  return {
    id: view.id,
    email: view.email,
    name: view.name,
    avatar: view.avatar,
    role: view.role,
    status: view.status,
    mustChangePassword: view.mustChangePassword,
    permissions: view.permissions,
  };
}

/**
 * 人鉴权权威服务（后端归一：原 web lib/auth 整体迁来，行为不变）。
 *
 * 负责会话生命周期（建/解析/滑动续期/吊销）、登录限流、改密与审计。
 * 密码 scrypt 校验、会话 token 哈希复用 @/auth。
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly attempts: LoginAttemptsRepository,
    private readonly audit: AuditLogsRepository,
    private readonly runtimeSettings: RuntimeSettingsService,
    private readonly tx: TxContext,
  ) {}

  /**
   * 解析会话 token → 当前用户（含权限 + sessionId）。
   * 无效 / 过期 / 账户停用一律返回 null，并顺手清理坏会话；活跃则滑动续期（限频写库）。
   */
  async resolveSession(token: string): Promise<AuthedUser | null> {
    const now = nowSec();
    const session = await this.sessions.findByTokenHash(hashSessionToken(token));
    if (!session) return null;
    if (Number(session.expires_at) <= now) {
      await this.sessions.deleteById(session.id);
      return null;
    }
    const user = await this.users.resolveWithPermissions(session.user_id);
    if (!user || user.status !== 'active') {
      await this.sessions.deleteById(session.id);
      return null;
    }
    if (now - Number(session.last_seen_at) >= SLIDE_THROTTLE) {
      const { idleDays, absoluteDays } = await this.runtimeSettings.getSessionConfig();
      const nextExpiry = Math.min(
        now + idleDays * DAY,
        Number(session.created_at) + absoluteDays * DAY,
      );
      await this.sessions.touch(session.id, now, nextExpiry);
    }
    return { ...stripHash(user), sessionId: session.id };
  }

  /** 登录：限流 → 校验邮箱+密码 → 建会话 + 回 token；错误文案统一不泄露存在性。 */
  async login(email: string, password: string, meta: LoginMeta): Promise<LoginResult> {
    if (!email || !password) throw new ValidationError('请输入邮箱和密码');
    try {
      const now = nowSec();
      const lock = await this.lockRemaining(email, now);
      if (lock > 0) {
        await this.audit.write({
          action: 'auth.login.locked',
          metadata: { email },
          ip: meta.ip ?? null,
        });
        throw new RateLimitError(`尝试过于频繁，请约 ${Math.ceil(lock / 60)} 分钟后再试`);
      }
      const view = await this.users.findAuthViewByEmail(email);
      const ok =
        !!view && view.status === 'active' && (await verifyPassword(password, view.passwordHash));
      if (!view || !ok) {
        await this.recordFailure(email, now);
        await this.audit.write({
          action: 'auth.login.failed',
          metadata: { email },
          ip: meta.ip ?? null,
        });
        throw new UnauthorizedError('邮箱或密码不正确');
      }
      const { idleDays, absoluteDays } = await this.runtimeSettings.getSessionConfig();
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      // 成功登录的副作用收进一个事务：清失败计数 + 建会话 + 记最近登录同生共死。
      await this.tx.run(async () => {
        await this.attempts.clear(email);
        await this.sessions.create({
          userId: view.id,
          tokenHash,
          expiresAt: now + idleDays * DAY,
          lastSeenAt: now,
          createdAt: now,
          userAgent: meta.userAgent ?? null,
          ip: meta.ip ?? null,
        });
        await this.users.updateLastLogin(view.id, now);
      });
      await this.audit.write({ actorId: view.id, action: 'auth.login', ip: meta.ip ?? null });
      return { token, user: stripHash(view), absoluteDays };
    } catch (e) {
      // 业务失败（限流 / 凭据错）原样冒泡；意外错误（DB 抖动等）记根因后才转 503
      if (e instanceof DomainError) throw e;
      logUnexpected('login', e);
      throw new ServiceUnavailableError('登录失败：服务暂时不可用，请稍后再试');
    }
  }

  /** 登出：吊销当前会话 + 写审计。 */
  async logout(token: string, actorId?: string): Promise<void> {
    await this.sessions.deleteByTokenHash(hashSessionToken(token));
    if (actorId) await this.audit.write({ actorId, action: 'auth.logout' });
  }

  /** 改密：校验当前密码 → 写新哈希、清强制改密标记、吊销其余会话。 */
  async changePassword(
    user: AuthedUser,
    current: string,
    next: string,
    confirm: string,
  ): Promise<void> {
    if (next.length < 8) throw new ValidationError('新密码至少 8 位');
    if (next !== confirm) throw new ValidationError('两次输入的新密码不一致');
    try {
      const row = await this.users.findById(user.id);
      if (!row || !(await verifyPassword(current, row.password_hash))) {
        throw new ValidationError('当前密码不正确');
      }
      const newHash = await hashPassword(next);
      // 改密与「踢其余会话」必须同生共死：崩在两步之间会留下「密码已改、旧会话仍有效」的窗口。
      await this.tx.run(async () => {
        await this.users.updatePassword(user.id, newHash, false, nowSec());
        await this.sessions.deleteOthers(user.id, user.sessionId);
      });
      await this.audit.write({ actorId: user.id, action: 'account.password.change' });
    } catch (e) {
      if (e instanceof DomainError) throw e;
      logUnexpected('changePassword', e);
      throw new ServiceUnavailableError('修改失败：服务暂时不可用，请稍后再试');
    }
  }

  /** 改本人姓名。 */
  async updateOwnName(user: AuthedUser, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError('姓名不能为空');
    try {
      await this.users.updateName(user.id, trimmed, nowSec());
    } catch (e) {
      if (e instanceof DomainError) throw e;
      logUnexpected('updateOwnName', e);
      throw new ServiceUnavailableError('保存失败：服务暂时不可用');
    }
  }

  /** 取指定用户的当前态（设备/会话双通道的 /api/me 用）。 */
  async getProfile(userId: string): Promise<CurrentUser | null> {
    const view = await this.users.resolveWithPermissions(userId);
    return view ? stripHash(view) : null;
  }

  /** 改本人头像（avatar=DiceBear seed；null 恢复姓名首字母）。 */
  async updateOwnAvatar(user: AuthedUser, avatar: string | null): Promise<void> {
    await this.updateAvatarById(user.id, avatar);
  }

  /** 按 id 改头像（设备通道 /api/me/avatar 复用，无 AuthedUser 时用）。 */
  async updateAvatarById(userId: string, avatar: string | null): Promise<void> {
    try {
      await this.users.updateAvatar(userId, avatar, nowSec());
    } catch (e) {
      if (e instanceof DomainError) throw e;
      logUnexpected('updateAvatarById', e);
      throw new ServiceUnavailableError('保存失败：服务暂时不可用');
    }
  }

  /** 个人中心：未过期会话列表（标记当前会话）。 */
  async listSessions(user: AuthedUser): Promise<SessionInfo[]> {
    const rows = await this.sessions.listActiveByUser(user.id, nowSec());
    return rows.map((s) => ({ ...s, current: s.id === user.sessionId }));
  }

  /** 个人中心：登出除当前外的其它会话。 */
  async revokeOtherSessions(user: AuthedUser): Promise<void> {
    await this.sessions.deleteOthers(user.id, user.sessionId);
  }

  /** 个人中心：登出指定会话（仅限本人会话）。 */
  async revokeSession(user: AuthedUser, sessionId: string): Promise<void> {
    await this.sessions.deleteOwn(sessionId, user.id);
  }

  // ── 限流（滑动窗 + 锁定）──────────────────────────────────────────────

  /** 邮箱当前的登录锁定剩余秒数；未锁返回 0。 */
  private async lockRemaining(email: string, now: number): Promise<number> {
    const row = await this.attempts.findByEmail(email);
    if (!row || row.locked_until == null) return 0;
    const remaining = Number(row.locked_until) - now;
    return remaining > 0 ? remaining : 0;
  }

  /** 记一次登录失败；滑动窗内累计达阈值则锁定一段时间。 */
  private async recordFailure(email: string, now: number): Promise<void> {
    const row = await this.attempts.findByEmail(email);
    const base = row && now - Number(row.last_attempt_at) <= WINDOW_SEC ? row.failed_count : 0;
    const failed = base + 1;
    const lockedUntil = failed >= MAX_FAILURES ? now + LOCK_SEC : null;
    await this.attempts.record(email, failed, lockedUntil, now);
  }
}
