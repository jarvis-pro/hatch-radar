import { beforeAll, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isSecretConfigured } from '../src/crypto';

/** 模型密钥 AES-256-GCM 加解密：往返一致、随机 IV、防篡改、格式校验。 */
describe('crypto（模型密钥加解密）', () => {
  beforeAll(() => {
    process.env.SETTINGS_SECRET ||= 'hatch-radar-test-secret-0123456789abcdef';
  });

  it('加密后能原样解密', () => {
    const plain = 'sk-ant-xxxxxxxxxxxx';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('每次加密用随机 IV（密文不同），但都解回同一明文', () => {
    const plain = 'sk-test-key';
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it('密文被篡改时解密抛出（GCM 认证失败）', () => {
    const [iv, tag, data] = encryptSecret('secret').split(':');
    const flipped = (data[0] === 'A' ? 'B' : 'A') + data.slice(1);
    expect(() => decryptSecret(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it('格式非法的密文抛出', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow('密文格式非法');
  });

  it('isSecretConfigured 反映 SETTINGS_SECRET 是否就位', () => {
    expect(isSecretConfigured()).toBe(true);
  });
});
