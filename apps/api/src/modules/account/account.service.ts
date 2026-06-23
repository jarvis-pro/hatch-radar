import { Injectable } from '@nestjs/common';
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from '@/auth';
import type { CurrentUser, SessionInfo } from '@hatch-radar/shared';
import { RuntimeSettingsService } from '../settings/runtime-settings.service';
import {
  AuditLogsRepository,
  LoginAttemptsRepository,
  SessionsRepository,
  TxContext,
  UsersRepository,
  type UserAuthView,
} from '@/database';
import {
  DomainError,
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '@/common/errors';
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
/** email 维度阈值：针对单账户的撞库，较紧。 */
const MAX_FAILURES = 5;
/** IP 维度阈值：单客户端 IP 的总失败上限，较松以容忍 NAT 后多用户共享出口，仍能挡单点爆破。 */
const IP_MAX_FAILURES = 20;
/** 滑动窗（秒）：上次失败超过此时长则失败计数从头算。 */
const WINDOW_SEC = 900;
/** 锁定时长（秒）。 */
const LOCK_SEC = 300;

/** 登录请求附带的客户端信息（写入会话与审计）。 */
export interface LoginMeta {
  /** 客户端 User-Agent（写入会话，供会话列表展示） */
  userAgent?: string;
  /** 客户端 IP（写入会话 + 审计；不可得时省略） */
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
   * 统一包裹会触达 DB 的方法：领域错误（业务失败）原样冒泡，其余意外错误（DB 抖动 / 约束冲突等）
   * 落根因日志后兜底成 ServiceUnavailableError。收口此处，杜绝各方法各写一份 try/catch 导致的覆盖不一致。
   * @param scope 出错日志的范围标签（方法名）
   * @param fallback 兜底 503 对外的用户文案
   * @param fn 实际业务逻辑（其 throw 的 DomainError 原样透传）
   */
  private async guard<T>(scope: string, fallback: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainError) {
        throw e;
      }

      logUnexpected(scope, e);
      throw new ServiceUnavailableError(fallback);
    }
  }

  /**
   * 解析会话 token → 当前用户（含权限 + sessionId）。
   * 无效 / 过期 / 账户停用一律返回 null，并顺手清理坏会话；活跃则滑动续期（限频写库）。
   * @param token 会话 token（明文，内部哈希后比对）
   * @returns 当前用户（含 sessionId）；无效 / 过期 / 停用时返回 null
   * @throws ServiceUnavailableError 意外错误（DB 抖动等）记根因后兜底——区别于「未登录」的 null
   */
  async resolveSession(token: string): Promise<AuthedUser | null> {
    return this.guard('resolveSession', '会话校验失败：服务暂时不可用', async () => {
      const now = nowSec();
      const session = await this.sessions.findByTokenHash(hashSessionToken(token));
      if (!session) {
        return null;
      }

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
    });
  }

  /**
   * 登录：限流 → 校验邮箱+密码 → 建会话 + 回 token；错误文案统一不泄露账户存在性。
   * - 成功的副作用（清失败计数 + 建会话 + 记最近登录）收进一个事务，同生共死
   * @param email 登录邮箱
   * @param password 明文密码
   * @param meta 客户端信息（User-Agent / IP，写入会话与审计）
   * @returns token（控制器据此 Set-Cookie）+ 用户态 + cookie 绝对生命周期天数
   * @throws ValidationError 邮箱或密码为空
   * @throws RateLimitError 滑动窗内失败次数达阈值被锁定
   * @throws UnauthorizedError 邮箱或密码不正确（账户不存在 / 停用同此文案，不泄露存在性）
   * @throws ServiceUnavailableError 意外错误（DB 抖动等）记根因后兜底
   */
  async login(email: string, password: string, meta: LoginMeta): Promise<LoginResult> {
    if (!email || !password) {
      throw new ValidationError('请输入邮箱和密码');
    }

    return this.guard('login', '登录失败：服务暂时不可用，请稍后再试', async () => {
      const now = nowSec();
      const lock = await this.lockRemaining(email, meta.ip, now);
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
        await this.recordFailure(email, meta.ip, now);
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
        await this.clearAttempts(email, meta.ip);
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
    });
  }

  /**
   * 登出：吊销当前会话 + 写审计。会话已由守卫解析，故凭 sessionId 直接删（无需再读 cookie / 哈希 token）。
   * @param sessionId 待吊销的会话 id（守卫解析出的当前会话）
   * @param actorId 操作者 id（写登出审计）
   * @throws ServiceUnavailableError 意外错误记根因后兜底
   */
  async logout(sessionId: string, actorId: string): Promise<void> {
    await this.guard('logout', '登出失败：服务暂时不可用', async () => {
      await this.sessions.deleteById(sessionId);
      await this.audit.write({ actorId, action: 'auth.logout' });
    });
  }

  /**
   * 改密：校验当前密码 → 写新哈希、清强制改密标记、吊销其余会话。
   * - 写新哈希与踢其余会话同事务，杜绝「密码已改、旧会话仍有效」的窗口
   * @param user 当前登录用户（含 sessionId，用于保留当前会话）
   * @param current 当前密码（明文，校验用）
   * @param next 新密码（明文，至少 8 位）
   * @param confirm 再次输入的新密码（须与 next 一致）
   * @throws ValidationError 新密码不足 8 位 / 两次输入不一致 / 当前密码不正确
   * @throws ServiceUnavailableError 意外错误记根因后兜底
   */
  async changePassword(
    user: AuthedUser,
    current: string,
    next: string,
    confirm: string,
  ): Promise<void> {
    if (next.length < 8) {
      throw new ValidationError('新密码至少 8 位');
    }

    if (next !== confirm) {
      throw new ValidationError('两次输入的新密码不一致');
    }

    await this.guard('changePassword', '修改失败：服务暂时不可用，请稍后再试', async () => {
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
    });
  }

  /**
   * 改本人姓名（首尾空白会被裁剪）。
   * @param user 当前登录用户
   * @param name 新姓名（首尾空白会被裁剪）
   * @throws ValidationError 姓名去空白后为空
   * @throws ServiceUnavailableError 意外错误记根因后兜底
   */
  async updateOwnName(user: AuthedUser, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new ValidationError('姓名不能为空');
    }

    await this.guard('updateOwnName', '保存失败：服务暂时不可用', async () => {
      await this.users.updateName(user.id, trimmed, nowSec());
    });
  }

  /**
   * 改本人头像（avatar=DiceBear seed；null 恢复姓名首字母）。
   * @param user 当前登录用户
   * @param avatar DiceBear seed；传 null 恢复姓名首字母
   * @throws ServiceUnavailableError 意外错误记根因后兜底
   */
  async updateOwnAvatar(user: AuthedUser, avatar: string | null): Promise<void> {
    await this.guard('updateOwnAvatar', '保存失败：服务暂时不可用', async () => {
      await this.users.updateAvatar(user.id, avatar, nowSec());
    });
  }

  /**
   * 个人中心：未过期会话列表（标记当前会话）。
   * @param user 当前登录用户（据 sessionId 标记 current）
   * @returns 会话列表，最近活跃在前
   * @throws ServiceUnavailableError 意外错误记根因后兜底
   */
  async listSessions(user: AuthedUser): Promise<SessionInfo[]> {
    return this.guard('listSessions', '获取会话失败：服务暂时不可用', async () => {
      const rows = await this.sessions.listActiveByUser(user.id, nowSec());

      return rows.map((s) => ({ ...s, current: s.id === user.sessionId }));
    });
  }

  /**
   * 个人中心：登出除当前外的其它会话。
   * @param user 当前登录用户（保留其 sessionId）
   * @throws ServiceUnavailableError 意外错误记根因后兜底
   */
  async revokeOtherSessions(user: AuthedUser): Promise<void> {
    await this.guard('revokeOtherSessions', '操作失败：服务暂时不可用', async () => {
      await this.sessions.deleteOthers(user.id, user.sessionId);
    });
  }

  /**
   * 个人中心：登出指定会话（仅限本人会话）。
   * @param user 当前登录用户（限定只能登出本人会话）
   * @param sessionId 待登出的会话 id
   * @throws ServiceUnavailableError 意外错误记根因后兜底
   */
  async revokeSession(user: AuthedUser, sessionId: string): Promise<void> {
    await this.guard('revokeSession', '操作失败：服务暂时不可用', async () => {
      await this.sessions.deleteOwn(sessionId, user.id);
    });
  }

  // ── 限流（双维：email + IP，各滑动窗 + 锁定）──────────────────────────

  /**
   * 本次登录涉及的限流桶：始终含 email 桶（针对账户，阈值紧）；IP 可得时叠加 IP 桶
   * （针对来源，阈值松以容忍 NAT）。两维独立计数，缓解「拿受害者邮箱反复失败把人锁死」的账户锁定 DoS——
   * 单点爆破会先打满攻击者自己的 IP 桶，而非锁死受害账户。
   * @param email 登录邮箱（已归一小写）
   * @param ip 客户端 IP；不可得时只返回 email 桶（回落到原单维行为）
   */
  private attemptBuckets(email: string, ip?: string): { key: string; maxFailures: number }[] {
    const buckets = [{ key: `email:${email}`, maxFailures: MAX_FAILURES }];
    if (ip) {
      buckets.push({ key: `ip:${ip}`, maxFailures: IP_MAX_FAILURES });
    }

    return buckets;
  }

  /** 本次登录涉及的任一限流桶的最长锁定剩余秒数；都未锁返回 0。 */
  private async lockRemaining(email: string, ip: string | undefined, now: number): Promise<number> {
    const rows = await Promise.all(
      this.attemptBuckets(email, ip).map((b) => this.attempts.findByKey(b.key)),
    );

    let max = 0;
    for (const row of rows) {
      if (row?.locked_until == null) {
        continue;
      }

      const remaining = Number(row.locked_until) - now;
      if (remaining > max) {
        max = remaining;
      }
    }

    return max;
  }

  /**
   * 记一次登录失败：对 email 桶与（可得时）IP 桶各原子累加 / 派生锁定（防并发丢计数），
   * 本处仅持有滑动窗与各维阈值策略。
   */
  private async recordFailure(email: string, ip: string | undefined, now: number): Promise<void> {
    await Promise.all(
      this.attemptBuckets(email, ip).map((b) =>
        this.attempts.recordFailure(b.key, {
          now,
          windowSec: WINDOW_SEC,
          maxFailures: b.maxFailures,
          lockSec: LOCK_SEC,
        }),
      ),
    );
  }

  /** 登录成功后清除本次涉及的限流桶计数（email + 可得的 IP）；在登录事务内顺序执行。 */
  private async clearAttempts(email: string, ip: string | undefined): Promise<void> {
    for (const b of this.attemptBuckets(email, ip)) {
      await this.attempts.clear(b.key);
    }
  }
}
