/**
 * 设备凭据验签（Node-only）：Ed25519 挑战-应答。
 *
 * 设备本地生成密钥对、私钥永不离设备，注册时上报原始 32 字节公钥（base64）；
 * sync 时设备用私钥签服务端下发的一次性 nonce，服务端用本模块验签——线上无可重放秘密。
 */
import { randomBytes, verify as verifyOneShot, createPublicKey } from 'node:crypto';

// 原始 32 字节 Ed25519 公钥 → DER(SPKI) 的固定前缀（RFC 8410），用于喂给 node:crypto。
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** 生成一次性挑战 nonce（base64url）。 */
export function generateNonce(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * 校验设备对 nonce 的 Ed25519 签名。
 * @param publicKeyB64 设备注册上报的原始 Ed25519 公钥（32 字节，base64）
 * @param nonce 服务端下发的挑战串（按 utf8 字节验签，须与设备签名时一致）
 * @param signatureB64 设备私钥对 nonce 的签名（base64）
 * @returns 验签是否通过；公钥/签名格式非法时返回 false（不抛）
 */
export function verifyDeviceSignature(
  publicKeyB64: string,
  nonce: string,
  signatureB64: string,
): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, 'base64');
    if (raw.length !== 32) {
      return false;
    }
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return verifyOneShot(
      null,
      Buffer.from(nonce, 'utf8'),
      key,
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}
