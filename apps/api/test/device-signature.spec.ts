import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyDeviceSignature } from '@/auth';

/**
 * 设备 Ed25519 验签（纯函数）。模拟 mobile：公钥以「原始 32 字节 base64」上报、私钥对 canonical 签名。
 * 重点覆盖 #4 的设计——canonical 含请求体哈希，换 body → canonical 变 → 验签必败（防换 body 重放）。
 */

/** 生成密钥对，返回 mobile 风格的原始 32 字节公钥 base64 + KeyObject 私钥。 */
function genKeys(): { publicKeyB64: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' }); // 44B = 12B SPKI 前缀 + 32B raw
  const raw = der.subarray(der.length - 32);

  return { publicKeyB64: raw.toString('base64'), privateKey };
}

function signCanonical(privateKey: KeyObject, canonical: string): string {
  return sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
}

describe('verifyDeviceSignature（Ed25519 设备验签）', () => {
  it('合法签名通过', () => {
    const { publicKeyB64, privateKey } = genKeys();
    const canonical = 'cred-1.1700000000.POST./api/sync/push.abc123';
    expect(
      verifyDeviceSignature(publicKeyB64, canonical, signCanonical(privateKey, canonical)),
    ).toBe(true);
  });

  it('canonical 被篡改（换 body 哈希）则验签失败 —— #4 防换 body 重放', () => {
    const { publicKeyB64, privateKey } = genKeys();
    const sig = signCanonical(privateKey, 'cred-1.1700000000.POST./api/sync/push.HASH_A');
    // 服务端按真实 req.rawBody 重算 canonical，body 不同 → 哈希不同 → 验签必败
    expect(
      verifyDeviceSignature(publicKeyB64, 'cred-1.1700000000.POST./api/sync/push.HASH_B', sig),
    ).toBe(false);
  });

  it('换一把密钥的签名验不过', () => {
    const a = genKeys();
    const b = genKeys();
    const canonical = 'cred-1.1700000000.GET./api/me.e3b0c4';
    expect(
      verifyDeviceSignature(a.publicKeyB64, canonical, signCanonical(b.privateKey, canonical)),
    ).toBe(false);
  });

  it('公钥 / 签名格式非法返回 false（不抛）', () => {
    expect(verifyDeviceSignature('not-32-bytes', 'x', 'y')).toBe(false);
    expect(verifyDeviceSignature('', '', '')).toBe(false);
  });
});
