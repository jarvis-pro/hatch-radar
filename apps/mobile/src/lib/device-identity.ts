import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { getMeta, setMeta } from '../db/schema';

/**
 * 设备身份：Ed25519 密钥对 + 激活码换凭据 + 请求签名（对应 server DeviceAuthService）。
 *
 * - 私钥本地生成、永不外传；签名 `${credentialId}.${ts}.${METHOD}.${path}` 防重放（服务端 60s 时间窗）。
 * - 当前私钥存本地 meta 表（与 device_id 同处）。**待办：升级到 expo-secure-store（需原生重建）以入安全区。**
 */

// tweetnacl 在 RN 下无 crypto.getRandomValues，用 expo-crypto 同步播种其 PRNG。
nacl.setPRNG((x, n) => {
  x.set(Crypto.getRandomBytes(n));
});

const SECRET_KEY = 'device_secret_key'; // base64(64B nacl secretKey)
const PUBLIC_KEY = 'device_public_key'; // base64(32B Ed25519 publicKey)
const CREDENTIAL_ID = 'device_credential_id';

interface DeviceKeyPair {
  publicKeyB64: string;
  secretKey: Uint8Array;
}

/** 取或生成本机设备密钥对（首次生成并落 meta）。 */
function getOrCreateKeyPair(): DeviceKeyPair {
  const sk = getMeta(SECRET_KEY);
  const pk = getMeta(PUBLIC_KEY);
  if (sk && pk) return { publicKeyB64: pk, secretKey: naclUtil.decodeBase64(sk) };
  const kp = nacl.sign.keyPair();
  const publicKeyB64 = naclUtil.encodeBase64(kp.publicKey);
  setMeta(SECRET_KEY, naclUtil.encodeBase64(kp.secretKey));
  setMeta(PUBLIC_KEY, publicKeyB64);
  return { publicKeyB64, secretKey: kp.secretKey };
}

/** 当前设备凭据 id（激活后才有；用作 x-device-id）。 */
export function getCredentialId(): string | null {
  const id = getMeta(CREDENTIAL_ID);
  return id ? id : null;
}

/** 本机是否已激活。 */
export function isEnrolled(): boolean {
  return getCredentialId() !== null;
}

/** 用激活码 + 设备公钥向 server 换取凭据（成功后存 credentialId）。 */
export async function enrollDevice(
  baseUrl: string,
  code: string,
  deviceName: string,
): Promise<void> {
  const { publicKeyB64 } = getOrCreateKeyPair();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${baseUrl}/api/auth/device/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), deviceName, publicKey: publicKeyB64 }),
      signal: controller.signal,
    });
    if (res.status === 401) throw new Error('激活码无效或已过期');
    if (!res.ok) throw new Error(`工作台返回 ${res.status}`);
    const data = (await res.json()) as { credentialId?: string };
    if (!data.credentialId) throw new Error('激活响应异常');
    setMeta(CREDENTIAL_ID, data.credentialId);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('连接超时：请确认与工作台在同一局域网', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 解除本机激活（清凭据；保留密钥对，可重新激活换新凭据）。 */
export function resetEnrollment(): void {
  setMeta(CREDENTIAL_ID, '');
}

/**
 * 为一次请求构造设备签名头；未激活返回空对象（调用方据此回退到旧令牌 / 匿名）。
 * @param method HTTP 方法（须与服务端 req.method 一致）
 * @param path 请求路径（去查询串后与服务端 req.path 一致）
 */
export function buildDeviceHeaders(method: string, path: string): Record<string, string> {
  const credentialId = getCredentialId();
  if (!credentialId) return {};
  const { secretKey } = getOrCreateKeyPair();
  const ts = Math.floor(Date.now() / 1000);
  const canonical = `${credentialId}.${ts}.${method.toUpperCase()}.${path.split('?')[0]}`;
  const sig = nacl.sign.detached(naclUtil.decodeUTF8(canonical), secretKey);
  return {
    'x-device-id': credentialId,
    'x-device-ts': String(ts),
    'x-device-sig': naclUtil.encodeBase64(sig),
  };
}
