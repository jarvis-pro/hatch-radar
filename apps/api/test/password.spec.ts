import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth';

/** scrypt 口令哈希（纯函数）：往返、错密码、随机盐、NFKC 归一、非法哈希串。 */
describe('password（scrypt 口令哈希）', () => {
  it('哈希后能用原密码校验通过', async () => {
    const hash = await hashPassword('Correct-Horse-9');
    expect(await verifyPassword('Correct-Horse-9', hash)).toBe(true);
  });

  it('错密码校验失败', async () => {
    const hash = await hashPassword('Correct-Horse-9');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('同一密码两次哈希不同（随机盐），但都校验通过', async () => {
    const a = await hashPassword('pw12345678');
    const b = await hashPassword('pw12345678');
    expect(a).not.toBe(b);
    expect(await verifyPassword('pw12345678', a)).toBe(true);
    expect(await verifyPassword('pw12345678', b)).toBe(true);
  });

  it('NFKC 归一：兼容等价码点视为同一密码', async () => {
    const hash = await hashPassword('ﬁ-test'); // U+FB01 连字 ﬁ，NFKC 拆成 f + i
    expect(await verifyPassword('fi-test', hash)).toBe(true);
  });

  it('格式非法的哈希串返回 false（不抛）', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:bad')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});
