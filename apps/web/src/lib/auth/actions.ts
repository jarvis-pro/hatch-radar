'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hashPassword, verifyPassword } from '@hatch-radar/auth';
import { getDb } from '@/lib/db';
import { nowSec } from './constants';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies';
import { createSession, revokeOtherSessions, revokeSessionByToken } from './session';
import { getCurrentUser } from './current-user';
import { writeAudit } from './audit';
import type { FormState, LoginState } from './types';

/** 仅允许站内相对路径跳转，挡开放重定向。 */
function safeNext(next: string): string {
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

async function clientIp(): Promise<string | undefined> {
  const xff = (await headers()).get('x-forwarded-for');
  return xff ? xff.split(',')[0]?.trim() || undefined : undefined;
}

/** 登录：校验邮箱+密码 → 建会话 + 写 cookie；错误文案统一不泄露存在性。 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const next = safeNext(String(formData.get('next') ?? '/'));
  if (!email || !password) return { error: '请输入邮箱和密码' };

  let redirectTo: string;
  try {
    const db = getDb();
    const ip = await clientIp();
    const user = await db.users.findUnique({ where: { email } });
    const ok =
      !!user && user.status === 'active' && (await verifyPassword(password, user.password_hash));
    if (!user || !ok) {
      await writeAudit({ action: 'auth.login.failed', metadata: { email }, ip });
      return { error: '邮箱或密码不正确' };
    }
    const token = await createSession(user.id, {
      userAgent: (await headers()).get('user-agent') ?? undefined,
      ip,
    });
    await setSessionCookie(token);
    await db.users.update({ where: { id: user.id }, data: { last_login_at: BigInt(nowSec()) } });
    await writeAudit({ actorId: user.id, action: 'auth.login', ip });
    redirectTo = user.must_change_password ? '/account/password' : next;
  } catch {
    return { error: '登录失败：服务暂时不可用，请稍后再试' };
  }
  redirect(redirectTo); // 在 try 外：redirect 以抛出特殊错误实现，不能被 catch 吞掉
}

/** 登出：吊销当前会话 + 清 cookie。 */
export async function logoutAction(): Promise<void> {
  const token = await readSessionCookie();
  const user = await getCurrentUser();
  if (token) await revokeSessionByToken(token);
  await clearSessionCookie();
  if (user) await writeAudit({ actorId: user.id, action: 'auth.logout' });
  redirect('/login');
}

/** 改密：校验当前密码 → 写新哈希、清强制改密标记、吊销其余会话。 */
export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const current = String(formData.get('current') ?? '');
  const pw = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (pw.length < 8) return { error: '新密码至少 8 位' };
  if (pw !== confirm) return { error: '两次输入的新密码不一致' };

  try {
    const db = getDb();
    const row = await db.users.findUnique({ where: { id: user.id } });
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      return { error: '当前密码不正确' };
    }
    await db.users.update({
      where: { id: user.id },
      data: {
        password_hash: await hashPassword(pw),
        must_change_password: false,
        updated_at: BigInt(nowSec()),
      },
    });
    await revokeOtherSessions(user.id, user.sessionId);
    await writeAudit({ actorId: user.id, action: 'account.password.change' });
  } catch {
    return { error: '修改失败：服务暂时不可用，请稍后再试' };
  }
  redirect('/');
}
